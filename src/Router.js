var async = require('async'),
	StaticScraper = require('./StaticScraper'),
	DynamicScraper = require('./DynamicScraper'),
	ScraperError = require('./ScraperError');

/**
 * Transforms a string into a regular expression.
 * This function is from the project Routes.js, under the MIT licence,
 *   {@link https://github.com/aaronblohowiak/routes.js} it's present
 *   in the file {@link https://github.com/aaronblohowiak/routes.js/blob/bdad0a1ae10d11981bb286550bb3b8a1a71909bd/dist/routes.js#L49}.
 *
 * @param  {!string} path String path.
 * @param  {!Array.<string>} keys Empty array to be filled with the
 *   keys ids.
 * @return {!RegExp} Regular expression.
 */
function pathToRegExp(path, keys) {
	path = path
		.concat('/?')
		.replace(/\/\(/g, '(?:/')
		.replace(/(\/)?(\.)?:(\w+)(?:(\(.*?\)))?(\?)?|\*/g, function(_, slash, format, key, capture, optional) {
			if (_ === '*') {
				keys.push(undefined);
				return _;
			}

			keys.push(key);
			slash = slash || '';
			return '' + (optional ? '' : slash) + '(?:' + (optional ? slash : '') + (format || '') + (capture || '([^/]+?)') + ')' + (optional || '');
		})
		.replace(/([\/.])/g, '\\$1')
		.replace(/\*/g, '(.*)');
	return new RegExp('^' + path + '$', 'i');
}

/**
 * @constructor
 */
var Router = function() {
	/**
	 * Chain of promises.
	 *
	 * @type {!Array.<!Object>}
	 * @private
	 */
	this.promises = [];
	/**
	 * Otherwise promise.
	 *
	 * @type {!function(!string=)}
	 * @private
	 */
	this.otherwiseFn = function() {};
	/**
	 * Error promise.
	 *
	 * @type {!function(!string=)}
	 * @private
	 */
	this.errorFn = function() {};
};
Router.prototype = {
	constructor: Router,
	/**
	 * Promise to url match. It's promise will fire only if the path
	 *   matches with and url being routed.
	 *
	 * @param  {!(string|RegExp|function(string):?)} path The
	 *   path or regular expression to match an url.
	 *   Alternatively a function that receives the url to be matched
	 *   can be passed. If the result is false, or any
	 *   !!result===false), the path is considered valid and the
	 *   scraping should be done. If ,in case of a valid path, an Object is returned, it will be associated with the params of this
	 *   route/path.
	 *   For more information on the path matching refer to {@link https://github.com/aaronblohowiak/routes.js/blob/76bc517037a0321507c4d84a0cdaca6db31ebaa4/README.md#path-formats}
	 * @return {!Router} This router.
	 * @public
	 */
	on: function(path) {
		var callback;
		if (typeof path === 'function') {
			callback = path;
		}

		this.promises.push({
			callback: callback ? function(url) {
				return callback(url);
			} : Router.pathMatcher(path),
			scraper: null,
			rqMethod: null
		});
		return this.get();
	},
	get: function() {
		var length = this.promises.length,
			last = this.promises[length - 1];
		if (length && last) {
			last.rqMethod = function(url) {
				last.scraper.get(url);
			};
			return this;
		} else {
			throw new ScraperError('');
		}
	},
	request: function(options) {
		var length = this.promises.length,
			last = this.promises[length - 1];
		if (length && last) {
			last.rqMethod = function(url) {
				options.uri = url;
				last.scraper.request(options);
			};
			return this;
		} else {
			throw new ScraperError('');
		}
	},
	/**
	 * On error promise. This promise fires when an error is thrown,
	 *   at this level there shouldn't be any error.
	 * This is a one time promise, which means that the last promise
	 *   is gonna be the one to be executed, if needed be.
	 *
	 * @param  {!function(!string, ?)} callback Function with the url
	 *   and the error as the parameters.
	 * @return {!Router} This router.
	 * @public
	 */
	onError: function(callback) {
		this.errorFn = callback;
		return this;
	},
	/**
	 * A promise to be triggered when none of the paths where matched.
	 * This is a one time promise, which means that the last promise
	 *   is gonna be the one to be executed.
	 *
	 * @param  {!function(!string=)} callback Function with the url as
	 *   a parameter.
	 * @return {!Router} This router.
	 * @public
	 */
	otherwise: function(callback) {
		this.otherwiseFn = callback;
		return this;
	},
	/**
	 * Creates a static scraper, and associates it with the current
	 *   router promise chain. Note that this method returns a
	 *   {@see ScraperPromise} of a {@see StaticScraper}.
	 *
	 * @return {!ScraperPromise} A promise for the scraper.
	 * @public
	 */
	createStatic: function() {
		var length = this.promises.length,
			last = this.promises[length - 1];
		if (length && last && !last.scraper) {
			var ss = StaticScraper.create();
			last.scraper = ss;
			return ss;
		} else {
			throw new ScraperError('');
		}
	},
	/**
	 * Creates a dynamic scraper, and associates it with the current
	 *   router promise chain. Note that this method returns a
	 *   {@see ScraperPromise} of a {@see DynamicScraper}.
	 *
	 * @return {!ScraperPromise} A promise for the scraper.
	 * @public
	 */
	createDynamic: function() {
		var length = this.promises.length,
			last = this.promises[length - 1];
		if (length && last && !last.scraper) {
			var ss = DynamicScraper.create();
			last.scraper = ss;
			return ss;
		} else {
			throw new ScraperError('');
		}
	},
	/**
	 * Routes a url through every path that matches it.
	 *
	 * @param  {!string} url The url to route.
	 * @param  {!function(boolean)} callback Function to call when the
	 *   routing is complete. If any of the paths was found the
	 *   parameter is true, false otherwise.
	 * @return {!Router} This router.
	 * @public
	 */
	route: function(url, callback) {
		var atLeastOne = false;
		var that = this;
		callback = callback || function() {};
		async.each(this.promises, function(promiseObj, done) {

			var promiseFn = promiseObj.callback,
				scraperPromise = promiseObj.scraper,
				reqMethod = promiseObj.rqMethod;
			var result = promiseFn(url);
			if (result) {
				atLeastOne = true;
				scraperPromise._setChainParameter(result);
				reqMethod(url);
			}
			done();

		}, function(err) {
			if (err) {
				that.errorFn(err);
			} else if (!atLeastOne) {
				that.otherwiseFn(url);
			}
			callback(atLeastOne);
		});
		return this;
	}
};

Router.pathMatcher = function(pathOrRE) {
	var pattern,
		keys = ['url'];
	if (pathOrRE instanceof RegExp) {
		pattern = pathOrRE;
	} else if (typeof pathOrRE === 'string') {
		pattern = pathToRegExp(pathOrRE, keys);
	} else {
		throw new Error('A path must be a string or a regular expression.');
	}

	return function patternMatchingFunction(url) {
		var match = pattern.exec(url);
		if (!match) {
			return false;
		} else if (match instanceof Object) {
			return keys.reduce(function(obj, value, index) {
				obj[value] = match[index];
				return obj;
			}, {});
		} else {
			return {};
		}
	};
};

module.exports = Router;