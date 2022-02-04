#!/usr/bin/env node

'use strict';

// exports root objects (app, con, its, k, etc)

const util = require('util');

const objc = (function() {
	const objc = require('objc');
	objc.import('AppKit'); // needed to obtain absolute paths to .app bundles given app name
	// import OpenScripting to get OSACopyScriptingDefinitionFromURL
	objc.import('/System/Library/Frameworks/Carbon.framework/Versions/A/Frameworks/OpenScripting.framework');
	return objc;
})();

const aesupport = require('./aesupport');
const aeappdata = require('./aeappdata');
const aeselectors = require('./aeselectors');
const aegluetable = require('./aegluetable');
const aeformatter = require('./aeformatter');
const aeerrors = require('./aeerrors');


/****************************************************************************************/
// PUBLIC


// TO DO: do proxies require `set:` to prevent accidental assignment? (this might only be an issue when proxy is assigned as var/let, not const)

const k = new Proxy({
		[util.inspect.custom]: () => 'nodeautomation.k',
	}, {
    get: function(target, name) {
    	// TO DO: decide what cases to put here
        switch (name) {
        case Symbol.toString:
//        case util.inspect.custom: // console.log(k) appears to bypass the `get` handler and go straight to proxied object
//            return function() { return 'k'; };
        case Symbol.toPrimitive:
        case Symbol.toStringTag:
        case Symbol.valueOf:
        case "constructor": // TO DO: ???
            return undefined;
        case "isKeyword":
            return aesupport.Keyword.isKeyword;
        case "fromTypeCode":
            return aesupport.Keyword.fromTypeCode;
        case "fromEnumCode":
            return aesupport.Keyword.fromEnumCode;
        }
        if (typeof name !== "string") { return undefined; } // ignore any other symbols
        return new aesupport.Keyword(name);
    }
});


function appRootFn() {} // Proxy requires object to be a function (it won't handle `apply` otherwise)

appRootFn[util.inspect.custom] = () => '[nodeautomation.app]';

const appRoot = new Proxy(appRootFn, { // targetable/untargeted app root
    apply: function(target, thisArg, argumentsList) { // app(NAMESTR) is shortcut for app.named(NAMESTR)
        const applicationIdentifier = argumentsList[0];
        if (applicationIdentifier === undefined) { throw new TypeError("Missing argument in app(...) call."); }
        const launchOptions = argumentsList[1] || [];
        return aeselectors.newRootSpecifier(new aeappdata.AppData('named', applicationIdentifier, launchOptions));
    },
    get: function(target, name) {
        switch (name) { // returns a fully qualified app object constructor or unqualified app object specifier
        case "named": // local app's name or path
        case "at": // remote app's eppc URL
        case "ID": // local app's bundle ID (String), PID (Integer), or AEAddressDesc (NSAppleEventDescriptor)
            return function(applicationIdentifier, launchOptions = {}) { // launch options is an object containing zero or more of: launch flags, relaunch mode option, raw terminology table
                if (applicationIdentifier === undefined) {
                    throw new TypeError(`Missing argument in app.${util.inspect(name)}(...) call.`);
                }
                return aeselectors.newRootSpecifier(new aeappdata.AppData(name, applicationIdentifier, launchOptions));
            }
        case "currentApplication":
            return function(launchOptions = {}) { // launchOptions for host process takes terminology option only
                return aeselectors.newRootSpecifier(new aeappdata.AppData(name, null, launchOptions));
            }
        case aesupport.__packSelf:
            return function(appData) { return aesupport.kAppRootDesc; };
        case aesupport.__appData:
            return aeappdata.untargetedAppData;
        case aesupport.__specifierRecord:
            return specifierRecord;
        case "isSpecifier":
            return function(value) { return aeselectors.isSpecifier(value); };
        case "toString":
        case util.inspect.custom:
            return function() { return 'app'; };
        case Symbol.toPrimitive:
        case Symbol.toStringTag:
        case "valueOf":
        case "constructor":
            return undefined;
        default: // return an untargeted app.NAME specifier (this can construct specifiers, but not commands)
            return aeappdata.untargetedAppRoot[name];
        }
    }
});


/****************************************************************************************/


module.exports = {
    app:                      appRoot, 
    con:                      aeappdata.untargetedConRoot, 
    its:                      aeappdata.untargetedItsRoot, 
    k:                        k, 
    File:                     aesupport.File,
    CommandError:             aeerrors.CommandError,
    exportSDEFDocumentation:  aegluetable.exportSDEFDocumentation,
    exportRawTerminology:     aegluetable.exportRawTerminology,
    __aesupport:			  aesupport, // for debug use only
};

