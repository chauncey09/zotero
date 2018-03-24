/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2009 Center for History and New Media
                     George Mason University, Fairfax, Virginia, USA
                     http://zotero.org
    
    This file is part of Zotero.
    
    Zotero is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    
    Zotero is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.
    
    You should have received a copy of the GNU Affero General Public License
    along with Zotero.  If not, see <http://www.gnu.org/licenses/>.
    
	
	Utilities based in part on code taken from Piggy Bank 2.1.1 (BSD-licensed)
	
    ***** END LICENSE BLOCK *****
*/

/**
 * @class All functions accessible from within Zotero.Utilities namespace inside sandboxed
 * translators
 *
 * @constructor
 * @augments Zotero.Utilities
 * @borrows Zotero.Date.formatDate as this.formatDate
 * @borrows Zotero.Date.strToDate as this.strToDate
 * @borrows Zotero.Date.strToISO as this.strToISO
 * @borrows Zotero.OpenURL.createContextObject as this.createContextObject
 * @borrows Zotero.OpenURL.parseContextObject as this.parseContextObject
 * @borrows Zotero.Multi.parseSerializedMultiField as this.parseSerializedMultiField
 * @borrows Zotero.subtagRegistry this.subtagRegistry
 * @borrows Zotero.HTTP.processDocuments as this.processDocuments
 * @borrows Zotero.HTTP.doPost as this.doPost
 * @param {Zotero.Translate} translate
 */

Zotero.Utilities.Translate = function(translate) {
	this._translate = translate;
}

var tmp = function() {};
tmp.prototype = Zotero.Utilities;
Zotero.Utilities.Translate.prototype = new tmp();

Zotero.Utilities.Translate.prototype.formatDate = Zotero.Date.formatDate;
Zotero.Utilities.Translate.prototype.strToDate = Zotero.Date.strToDate;
Zotero.Utilities.Translate.prototype.strToISO = Zotero.Date.strToISO;
Zotero.Utilities.parseDateToObject = Zotero.DateParser.parseDateToObject;
Zotero.Utilities.convertDateObjectToString = Zotero.DateParser.convertDateObjectToString;
Zotero.Utilities.parseDateToString = Zotero.DateParser.parseDateToString;
Zotero.Utilities.resetDateParserMonths = Zotero.DateParser.resetDateParserMonths;
Zotero.Utilities.addDateParserMonths = Zotero.DateParser.addDateParserMonths;
Zotero.Utilities.Translate.prototype.createContextObject = Zotero.OpenURL.createContextObject;
Zotero.Utilities.Translate.prototype.parseContextObject = Zotero.OpenURL.parseContextObject;
Zotero.Utilities.Translate.prototype.subtagRegistry = Zotero.subtagRegistry;

/**
 * Hack to overloads {@link Zotero.Utilities.capitalizeTitle} to allow overriding capitalizeTitles 
 * pref on a per-translate instance basis (for translator testing only)
 */
Zotero.Utilities.Translate.prototype.capitalizeTitle = function(string, force) {
	if(force === undefined) {
		var translate = this._translate;
		do {
			if(translate.capitalizeTitles !== undefined) {
				force = translate.capitalizeTitles;
				break;
			}
		} while(translate = translate._parentTranslator);
	}
	
	return Zotero.Utilities.capitalizeTitle(string, force);
}

/**
 * Gets the current Zotero version
 *
 * @type String
 */
Zotero.Utilities.Translate.prototype.getVersion = function() {
	return Zotero.version;
}

/**
 * Extras for some translators
 */
Zotero.Utilities.Translate.prototype.getAppExtra = function(id) {
	var TRANSLATOR_INFO = {
		T6a3e392d_1284_4c81_89b9_4994a2d8a290: "MDg4NTNmMDk1YmExMTI5OTVjNmNmNTZlZDNhMjhhNTY1YjQ5ODE5MA=="
	}
	id = "T" + id.replace(/-/g, "_");
    return atob(TRANSLATOR_INFO[id]);
}

/**
 * Takes an XPath query and returns the results
 *
 * @deprecated Use {@link Zotero.Utilities.xpath} or doc.evaluate() directly
 * @type Node[]
 */
Zotero.Utilities.Translate.prototype.gatherElementsOnXPath = function(doc, parentNode, xpath, nsResolver) {
	var elmts = [];
	
	var iterator = doc.evaluate(xpath, parentNode, nsResolver,
		(Zotero.isFx ? Components.interfaces.nsIDOMXPathResult.ANY_TYPE : XPathResult.ANY_TYPE),
		null);
	var elmt = iterator.iterateNext();
	var i = 0;
	while (elmt) {
		elmts[i++] = elmt;
		elmt = iterator.iterateNext();
	}
	return elmts;
}

/**
 * Gets a given node as a string containing all child nodes
 *
 * @deprecated Use doc.evaluate and the "nodeValue" or "textContent" property
 * @type String
 */
Zotero.Utilities.Translate.prototype.getNodeString = function(doc, contextNode, xpath, nsResolver) {
	var elmts = this.gatherElementsOnXPath(doc, contextNode, xpath, nsResolver);
	var returnVar = "";
	for(var i=0; i<elmts.length; i++) {
		returnVar += elmts[i].nodeValue;
	}
	return returnVar;
}

/**
 * Grabs items based on URLs
 *
 * @param {Document} doc DOM document object
 * @param {Element|Element[]} inHere DOM element(s) to process
 * @param {RegExp} [urlRe] Regexp of URLs to add to list
 * @param {RegExp} [urlRe] Regexp of URLs to reject
 * @return {Object} Associative array of link => textContent pairs, suitable for passing to
 *	Zotero.selectItems from within a translator
 */
Zotero.Utilities.Translate.prototype.getItemArray = function(doc, inHere, urlRe, rejectRe) {
	var availableItems = new Object();	// Technically, associative arrays are objects
	
	// Require link to match this
	if(urlRe) {
		if(urlRe.exec) {
			var urlRegexp = urlRe;
		} else {
			var urlRegexp = new RegExp();
			urlRegexp.compile(urlRe, "i");
		}
	}
	// Do not allow text to match this
	if(rejectRe) {
		if(rejectRe.exec) {
			var rejectRegexp = rejectRe;
		} else {
			var rejectRegexp = new RegExp();
			rejectRegexp.compile(rejectRe, "i");
		}
	}
	
	if(!inHere.length) {
		inHere = new Array(inHere);
	}
	
	for(var j=0; j<inHere.length; j++) {
		var links = inHere[j].getElementsByTagName("a");
		for(var i=0; i<links.length; i++) {
			if(!urlRe || urlRegexp.test(links[i].href)) {
				var text = "textContent" in links[i] ? links[i].textContent : links[i].innerText;
				if(text) {
					text = this.trimInternal(text);
					if(!rejectRe || !rejectRegexp.test(text)) {
						if(availableItems[links[i].href]) {
							if(text != availableItems[links[i].href]) {
								availableItems[links[i].href] += " "+text;
							}
						} else {
							availableItems[links[i].href] = text;
						}
					}
				}
			}
		}
	}
	
	return availableItems;
}


/**
 * Load a single document in a hidden browser
 *
 * @deprecated Use processDocuments with a single URL
 * @see Zotero.Utilities.Translate#processDocuments
 */
Zotero.Utilities.Translate.prototype.loadDocument = function(url, succeeded, failed) {
	Zotero.debug("Zotero.Utilities.loadDocument is deprecated; please use processDocuments in new code");
	this.processDocuments([url], succeeded, null, failed);
}

/**
 * Already documented in Zotero.HTTP, except this optionally takes noCompleteOnError, which prevents
 * the translation process from being cancelled automatically on error, as it is normally. The promise
 * is still rejected on error for handling by the calling function.
 * @ignore
 */
Zotero.Utilities.Translate.prototype.processDocuments = async function (urls, processor, noCompleteOnError) {
	// Handle old signature: urls, processor, onDone, onError
	if (arguments.length > 3 || typeof arguments[2] == 'function') {
		Zotero.debug("ZU.processDocuments() now takes only 3 arguments -- update your code");
		var onDone = arguments[2];
		var onError = arguments[3];
		noCompleteOnError = false;
	}
	
	var translate = this._translate;

	if (typeof urls == "string") {
		urls = [translate.resolveURL(urls)];
	} else {
		for(var i in urls) {
			urls[i] = translate.resolveURL(urls[i]);
		}
	}
	
	var processDoc = function (doc) {
		if (Zotero.isFx) {
			let newLoc = doc.location;
			let url = Services.io.newURI(newLoc.href, null, null);
			return processor(
				// Rewrap document for the sandbox
				translate._sandboxManager.wrap(
					Zotero.Translate.DOMWrapper.unwrap(doc),
					null,
					// Duplicate overrides from Zotero.HTTP.wrapDocument()
					{
						documentURI: newLoc.spec,
						URL: newLoc.spec,
						location: new Zotero.HTTP.Location(url),
						defaultView: new Zotero.HTTP.Window(url)
					}
				),
				newLoc.href
			);
		}
		
		return processor(doc, doc.location.href);
	};
	
	var funcs = [];
	// If current URL passed, use loaded document instead of reloading
	for (var i = 0; i < urls.length; i++) {
		if(translate.document && translate.document.location
				&& translate.document.location.toString() === urls[i]) {
			Zotero.debug("Translate: Attempted to load the current document using processDocuments; using loaded document instead");
			funcs.push(() => processDoc(this._translate.document, urls[i]));
			urls.splice(i, 1);
			i--;
		}
	}
	
	translate.incrementAsyncProcesses("Zotero.Utilities.Translate#processDocuments");
	
	if (urls.length) {
		funcs.push(
			() => Zotero.HTTP.processDocuments(
				urls,
				function (doc) {
					if (!processor) return;
					return processDoc(doc);
				},
				translate.cookieSandbox
			)
		);
	}
	
	var f;
	while (f = funcs.shift()) {
		try {
			let maybePromise = f();
			// The processor may or may not return a promise
			if (maybePromise) {
				await maybePromise;
			}
		}
		catch (e) {
			if (onError) {
				try {
					onError(e);
				}
				catch (e) {
					translate.complete(false, e);
				}
			}
			// Unless instructed otherwise, end the translation on error
			else if (!noCompleteOnError) {
				translate.complete(false, e);
			}
			throw e;
		}
	}
	
	// Deprecated
	if (onDone) {
		onDone();
	}
	
	translate.decrementAsyncProcesses("Zotero.Utilities.Translate#processDocuments");
}

/**
* Send an HTTP GET request via XMLHTTPRequest
* 
* @param {String|String[]} urls URL(s) to request
* @param {Function} processor Callback to be executed for each document loaded
* @param {Function} done Callback to be executed after all documents have been loaded
* @param {String} responseCharset Character set to force on the response
* @param {Object} requestHeaders HTTP headers to include with request
* @return {Boolean} True if the request was sent, or false if the browser is offline
*/
Zotero.Utilities.Translate.prototype.doGet = function(urls, processor, done, responseCharset, requestHeaders) {
	var callAgain = false,
		me = this,
		translate = this._translate;
	
	if(typeof(urls) == "string") {
		var url = urls;
	} else {
		if(urls.length > 1) callAgain = true;
		var url = urls.shift();
	}
	
	url = translate.resolveURL(url);
	
	translate.incrementAsyncProcesses("Zotero.Utilities.Translate#doGet");
	var xmlhttp = Zotero.HTTP.doGet(url, function(xmlhttp) {
		try {
			if(processor) {
				processor(xmlhttp.responseText, xmlhttp, url);
			}
			
			if(callAgain) {
				me.doGet(urls, processor, done, responseCharset);
			} else {
				if(done) {
					done();
				}
			}
			translate.decrementAsyncProcesses("Zotero.Utilities.Translate#doGet");
		} catch(e) {
			translate.complete(false, e);
		}
	}, responseCharset, this._translate.cookieSandbox, requestHeaders);
}

/**
 * Already documented in Zotero.HTTP
 * @ignore
 */
Zotero.Utilities.Translate.prototype.doPost = function(url, body, onDone, headers, responseCharset) {
	var translate = this._translate;
	url = translate.resolveURL(url);
	
	translate.incrementAsyncProcesses("Zotero.Utilities.Translate#doPost");
	var xmlhttp = Zotero.HTTP.doPost(url, body, function(xmlhttp) {
		try {
			onDone(xmlhttp.responseText, xmlhttp);
			translate.decrementAsyncProcesses("Zotero.Utilities.Translate#doPost");
		} catch(e) {
			translate.complete(false, e);
		}
	}, headers, responseCharset, translate.cookieSandbox ? translate.cookieSandbox : undefined);
}

Zotero.Utilities.Translate.prototype.urlToProxy = function(url) {
	var proxy = this._translate._proxy;
	if (proxy) return proxy.toProxy(url);
	return url;
};

Zotero.Utilities.Translate.prototype.urlToProper = function(url) {
	var proxy = this._translate._proxy;
	if (proxy) return proxy.toProper(url);
	return url;
};

Zotero.Utilities.Translate.prototype.__exposedProps__ = {"HTTP":"r"};
for(var j in Zotero.Utilities.Translate.prototype) {
	if(typeof Zotero.Utilities.Translate.prototype[j] === "function" && j[0] !== "_" && j != "Translate") {
		Zotero.Utilities.Translate.prototype.__exposedProps__[j] = "r";
	}
}
