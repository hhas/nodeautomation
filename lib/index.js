#!/usr/bin/env node

'use strict';

// exports root objects (app, con, its, k, etc)

const util = require('util');

const objc = require('objc');
objc.import('Foundation');
objc.import('AppKit'); // needed to obtain absolute paths to .app bundles given app name
// need to import OpenScripting to get OSACopyScriptingDefinitionFromURL
objc.import('/System/Library/Frameworks/Carbon.framework/Versions/A/Frameworks/OpenScripting.framework');


const aesupport = require('./aesupport');
const aeappdata = require('./aeappdata');
const aeselectors = require('./aeselectors');
const aegluetable = require('./aegluetable');
const aeformatter = require('./aeformatter');
const aeerrors = require('./aeerrors');


/****************************************************************************************/
// PUBLIC


const k = new Proxy({}, {
    get: function(target, name) {
        switch (name) {
        case "toString":
        case util.inspect.custom: 
            return function() { return 'k'; };
        case Symbol.toPrimitive:
        case Symbol.toStringTag:
        case "valueOf":
        case "constructor":
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


const appRoot = new Proxy(function() {}, { // targetable/untargeted app root
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
        case "__nodeautomation_pack__":
            return function(appData) { return aesupport.kAppRootDesc; };
        case "__nodeautomation_appData__":
            return aeappdata.untargetedAppData;
        case "__nodeautomation_specifierRecord__":
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
};

