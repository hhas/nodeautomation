#!/usr/bin/env node

'use strict';

// reference

// TO DO: where to put autorelease pools?

// caution: for params, need to pass `#0x00000000`, NOT `0x00000000`, as keys, as hex numbers are auto-converted to decimal strings which can't reliably be distinguished from four-char codes; alternatively, allow escapes in four-char strings, although that could be problematic too

// TO DO: how to support customRoot(value)?


const util = require('util');

const objc = require('./objc');

const aesupport = require('./aesupport');
const aeappdata = require('./aeappdata');
const aeselectors = require('./aeselectors');
const aeformatter = require('./aeformatter');


/****************************************************************************************/
// PUBLIC


const k = new Proxy({}, {
    get: function(target, name) {
        switch (name) {
        case Symbol.toPrimitive: // TO DO: what other special JS methods do we need to handle?
        case util.inspect.custom: 
        case "toString":
            return function() { return 'k' };
        case Symbol.toStringTag:
        case "valueOf":
        case "constructor":
            return undefined;
        }
        if (typeof name !== "string") { return undefined; } // ignore any other symbols
        return new aesupport.Keyword(name);
    }
});


const appRoot = new Proxy(function() {}, { // targetable/untargeted app root
    apply: function(target, thisArg, argumentsList) { // app(NAMESTR) is shortcut for app.named(NAMESTR)
        const applicationIdentifier = argumentsList[0];
        const launchOptions = (argumentsList.length > 1) ? argumentsList[1] : [];
        if (applicationIdentifier === undefined) {
            throw new TypeError("Missing argument in app(...) call.");
        }
        return aeselectors.newRootSpecifier(new aeappdata.AppData('named', applicationIdentifier, launchOptions));
    },
    get: function(target, name) {
        switch (name) { // returns a fully qualified app object constructor or unqualified app object specifier
        case "named": // local app's name or path
        case "at": // remote app's eppc URL
        case "ID": // local app's bundle ID (String), PID (Integer), or AEAddressDesc (NSAppleEventDescriptor)
            //console.log(`Constructing app.${name} function...`);
            return function(applicationIdentifier, launchOptions = {}) { // launch options is an object containing standard macOS process launch flags, relaunch mode option, and aete/sdef/termtable/defaulttermsonly option
                //console.log(`Created app.${name}(${applicationIdentifier}).`);
                if (applicationIdentifier === undefined) {
                    throw new TypeError(`Missing argument in app.${util.inspect(name)}(...) call.`);
                }
                return aeselectors.newRootSpecifier(new aeappdata.AppData(name, applicationIdentifier, launchOptions));
            }
        case "currentApplication":
            return function(launchOptions = {}) { // restricted launchOptions takes terminology option only
                return aeselectors.newRootSpecifier(new aeappdata.AppData(name, null, launchOptions));
            }
        case Symbol.toPrimitive: // TO DO: what other special JS methods do we need to handle?
        case util.inspect.custom: 
        case "toString":
            return function() { return 'app'; };
         // TO DO: use this specifier's own appData if it's targeted, and only use appData passed here if it's not?
        case "__nodeautomation_pack__":
            return function(appData) { return aesupport.kAppRootDesc; };
        case "__nodeautomation_appData__":
            return aeappdata.untargetedAppData;
        case "__nodeautomation_specifierRecord__":
            return specifierRecord;
        default: // return an untargeted app.NAME specifier (this can construct specifiers, but not commands)
            return aeappdata.untargetedAppRoot[name];
        }
    }
});


/****************************************************************************************/


module.exports = {app:appRoot, 
                  con:aeappdata.untargetedConRoot, 
                  its:aeappdata.untargetedItsRoot, 
                  k:k, 
                  File:aesupport.File, 
                  // TO DO: should following appear as methods on app, k, File respectively?
                  isSpecifier:aeselectors.isSpecifier, 
                  isKeyword:aesupport.isKeyword, 
                  isFile:aesupport.isFile};

