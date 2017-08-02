#!/usr/bin/env node

'use strict';

// AppData

const objc = require('./objc');

const aeselectors = require('./aeselectors');
const aeformatter = require('./aeformatter');
const aegluetable = require('./aegluetable');
const aesupport = require('./aesupport');
const aeerrors = require('./aeerrors');


/****************************************************************************************/
// application launch/relaunch options

// -[NSWorkspace launchApplicationAtURL:options:configuration:error:]

const kLaunchOptions = {
    launchWithErrorPresentation:    objc.NSWorkspaceLaunchWithErrorPresentation,
    launchInhibitingBackgroundOnly: objc.NSWorkspaceLaunchInhibitingBackgroundOnly,
    launchWithoutAddingToRecents:   objc.NSWorkspaceLaunchWithoutAddingToRecents,
    launchWithoutActivation:        objc.NSWorkspaceLaunchWithoutActivation,
    launchNewInstance:              objc.NSWorkspaceLaunchNewInstance,
    launchAndHide:                  objc.NSWorkspaceLaunchAndHide,
    launchAndHideOthers:            objc.NSWorkspaceLaunchAndHideOthers,
}; // launchAndPrint and launchAsync are omitted as they're not appropriate here

const kDefaultLaunchOptions = kLaunchOptions.launchWithoutActivation;

function readLaunchOptions(value) { // [Keyword,...] -> UInt32
    var launch = 0, relaunch = 0;
    if (!Array.isArray(value)) { value = [value]; }
    for (var item in value) {
        if (!aesupport.isKeyword(item)) {
            throw new TypeError(
                    `Bad "launchOptions" value (not an array of keywords): ${aeformatter.formatValue(value)}`);
        }
        const flag = kLaunchOptions[item.__nodeautomation_keywordName__];
        if (flag === undefined) {
            throw new TypeError(
                    `Bad "launchOptions" value (unknown "${item}" keyword): ${aeformatter.formatValue(value)}`);
        }
        launch |= flag;
    }
    return launch;
}

// relaunch mode

const kRelaunchModes = {
    neverRelaunch:   1,
    limitedRelaunch: 2,
    alwaysRelaunch:  3,
};

const kDefaultRelaunchMode = kRelaunchModes.limitedRelaunch;

function readRelaunchMode(value) {
    if (!aesupport.isKeyword(value)) {
         throw new TypeError(`Bad "relaunchMode" value (not a keyword): ${aeformatter.formatValue(value)}`);
    }
    const flag = kLaunchOptions[value.__nodeautomation_keywordName__];
    if (flag === undefined) {
        throw new TypeError(`Bad "relaunchMode" value (unknown "${value}" keyword): ${value}`);
    }
    return flag;
}

// the following AEM errors indicate when a previously targeted target process is no longer running (has quit/crashed)
const kRelaunchableErrorCodes = [-600, -609];

// when limitedRelaunch mode (the default) is used, the following events are allowed to relaunch an app
const kLimitedRelaunchEvents = [[objc.kCoreEventClass, objc.kAEOpenApplication], 
                                [objc.kASAppleScriptSuite, objc.kASLaunchEvent]];


/****************************************************************************************/
// -[NSAppleEventDescriptor sendEventWithOptions:timeout:] flags

const kSendOptions = {
    ignoreReply:    0x00000001, /* sender doesn't want a reply to event */
    queueReply:     0x00000002, /* sender wants a reply but won't wait */
    waitReply:      0x00000003, /* sender wants a reply and will wait */
    neverInteract:  0x00000010, /* server should not interact with user */
    canInteract:    0x00000020, /* server may try to interact with user */
    alwaysInteract: 0x00000030, /* server should always interact with user where appropriate */
    canSwitchLayer: 0x00000040, /* interaction may switch layer */
    dontRecord:     0x00001000, /* don't record this event */
    dontExecute:    0x00002000, /* don't send the event for recording */
    dontAnnotate:   0x00010000, /* if set, don't automatically add any sandbox or other annotations to the event */
    defaultOptions: 0x00000003 | 0x00000020, /* waitForReply | canInteract */
};

function readSendOptions(value) { // [Keyword,...] -> UInt32
    var sendFlags = 0;
    if (!Array.isArray(value)) { value = [value]; }
    for (var item of value) {
        if (!aesupport.isKeyword(item)) {
            throw new TypeError(`Bad "sendOptions" value (not an array of keywords): ${aeformatter.formatValue(value)}`);
        }
        const flag = kSendOptions[item.__nodeautomation_keywordName__];
        if (flag === undefined) {
            throw new TypeError(`Bad "sendOptions" value (contains unknown "${item}" keyword): ${aeformatter.formatValue(value)}`);
        } else if (flag & 0x03 && sendFlags & 0x03 || flag & 0x30 && sendFlags & 0x30) {
            throw new TypeError(`Bad "sendOptions" value (contains more than one "${flag & 0x03 ? 'reply' : 'interact'}" option): ${aeformatter.formatValue(value)}`);
        }
        sendFlags |= flag;
    }
    if (!(sendFlags & 0x03)) { sendFlags |= kSendOptions.waitReply; }
    if (!(sendFlags & 0x30)) { sendFlags |= kSendOptions.canInteract; }
    return sendFlags;
}

const kDefaultSendOptions = kSendOptions.defaultOptions;


/****************************************************************************************/
// considering/ignoring options (where supported by apps)

const kIgnoringOptions = {
    case:           {desc:aesupport.newEnumDescriptor(objc.kAECase),           ignore:0x00010000, consider:0x00000001},
    diacritic:      {desc:aesupport.newEnumDescriptor(objc.kAEDiacritic),      ignore:0x00020000, consider:0x00000002},
    whiteSpace:     {desc:aesupport.newEnumDescriptor(objc.kAEWhiteSpace),     ignore:0x00040000, consider:0x00000004},
    hyphens:        {desc:aesupport.newEnumDescriptor(objc.kAEHyphens),        ignore:0x00080000, consider:0x00000008},
    expansion:      {desc:aesupport.newEnumDescriptor(objc.kAEExpansion),      ignore:0x00100000, consider:0x00000010},
    punctuation:    {desc:aesupport.newEnumDescriptor(objc.kAEPunctuation),    ignore:0x00200000, consider:0x00000020},
    numericStrings: {desc:aesupport.newEnumDescriptor(objc.kASNumericStrings), ignore:0x00800000, consider:0x00000080},
}; 

const _considerAll = (function() { var result = 0;
                                   for (var k in kIgnoringOptions) { result |= kIgnoringOptions[k].consider; }
                                   return result; })();


function readIgnoringOptions(value) { // [Keyword,...] -> [AEListDesc,AEDesc]
    var considerIgnoreFlags = _considerAll; // all considering flags; these will be unset as ignoring flags are set
    const ignoresDesc = objc.NSAppleEventDescriptor('listDescriptor');
    if (!(value instanceof Array)) { value = [value]; }
    for (var item of value) {
        if (typeof item !== 'object') {
            throw new aeerrors.ParameterError(value, 'Bad "ignoring" attribute');
        }
        const optionDef = kIgnoringOptions[item.__nodeautomation_keywordName__];
        if (optionDef === undefined) {
            throw new TypeError(`Bad "ignoring" attribute (unknown item: ${item}): ${aeformatter.formatValue(value)}`);
        }
        considerIgnoreFlags |= optionDef.ignore;
        considerIgnoreFlags &= ~optionDef.consider;
        ignoresDesc('insertDescriptor', optionDef.desc, 'atIndex', 0);
    }
    return [ignoresDesc, aesupport.newUInt32Descriptor(considerIgnoreFlags)];
}

const kDefaultIgnoringDescriptors = readIgnoringOptions([new aesupport.Keyword('case')]);


/****************************************************************************************/
// other constants


// bug workaround: NSAppleEventDescriptor.sendEvent(options:timeout:) method's support for kAEDefaultTimeout=-1 and kNoTimeOut=-2 flags is buggy <rdar://21477694>, so for now the default timeout is hardcoded here as 120sec (same as in AS)
// const kAEDefaultTimeout = -1
// const kNoTimeOut = -2
const kDefaultTimeout = 120 


const kMissingValueDescriptor = objc.NSAppleEventDescriptor('descriptorWithTypeCode', objc(objc.cMissingValue));


/****************************************************************************************/
// find and launch application processes

// TO DO: this seems to give different result to AS's `running` when `launch` was used to semi-start process

function fileIDForURL(url) { // NSURL -> NSData // used in determining if two existing file URLs identify same inode
    const fileIDRef = objc.alloc(objc.NSData, objc.NIL).ref();
    if (!url('getResourceValue', fileIDRef, 'forKey', objc.NSURLFileResourceIdentifierKey, 'error', null)) {
        throw new Error(`Can't get NSURLFileResourceIdentifierKey for ${url}`);
    }
    return fileIDRef.deref();
}


function processForLocalApplication(url) { // NSURL -> NSRunningApplication/null
    const bundle = objc.NSBundle('bundleWithURL', url);
    if (!bundle) { throw new aeerrors.ConnectionError(`Application not found: ${url('path').toString()}`); }
    const bundleID = bundle('bundleIdentifier');
    if (!bundleID) { throw new aeerrors.ConnectionError(`Application not found: ${url('path').toString()}`); }
    const foundProcesses = objc.NSRunningApplication('runningApplicationsWithBundleIdentifier', bundleID);
    const fileID = fileIDForURL(url);
    for (var i = 0; i < foundProcesses('count'); i++) {
        const process = foundProcesses('objectAtIndex', i);
        if (fileIDForURL(process('bundleURL'))('isEqual', fileID)) { return process; }
    }
    return null;
}


function infoForNSError(error) { // NSError -> (string, number); extract error message + number from NSError
    return [error('localizedDescription').toString(), error('code')];
}


function processDescriptorForLocalApplication(url, launchOptions) { // (NSURL, NSWorkspaceLaunchOptions) // file URL
    // get a typeKernelProcessID AEAddressDesc for the target app, finding and launch it first if not already running;
    // if app can't be found/launched, throws a ConnectionError/NSError instead
    var runningProcess = processForLocalApplication(url);
    if (!runningProcess) {
        var error = objc.alloc(objc.NSError, objc.NIL).ref();
        launchOptions = launchOptions |= kLaunchOptions.launchWithoutActivation; // TO DO: decide if this is best solution
        runningProcess = objc.NSWorkspace('sharedWorkspace')('launchApplicationAtURL', url, 
                                                             'options', launchOptions, 
                                                             'configuration', objc.NSDictionary('dictionary'), 
                                                             'error', error);
        if (!runningProcess) {
            const [message, number] = infoForNSError(error.deref());
            throw new aeerrors.ConnectionError(
                    `Can't launch application at ${util.inspect(url('path').toString())}: ${message}`, number);
        }
    }
    return objc.NSAppleEventDescriptor('descriptorWithProcessIdentifier', runningProcess('processIdentifier'));
}


const kProcessNotFoundErrorNumbers = [objc.procNotFound, objc.connectionInvalid, objc.localOnlyErr];

const kLaunchEvent = objc.NSAppleEventDescriptor('appleEventWithEventClass', objc.kASAppleScriptSuite, 
                                                 'eventID', objc.kASLaunchEvent,
                                                 'targetDescriptor', null, 
                                                 'returnID', objc.kAutoGenerateReturnID,
                                                 'transactionID', objc.kAnyTransactionID);

function launchApplicationAtURL(url) { // NSURL -- fileURL
    const config = objc.NSDictionary('dictionaryWithObject', kLaunchEvent,  
                                     'forKey', objc('NSWorkspaceLaunchConfigurationAppleEvent'));
    var error = objc.alloc(objc.NSError, objc.NIL).ref();
    const runningProcess = objc.NSWorkspace('sharedWorkspace')('launchApplicationAtURL', url, 
                                                               'options', kLaunchOptions.launchWithoutActivation,
                                                               'configuration', config,
                                                               'error', error);
    if (!runningProcess) {
        const [message, number] = infoForNSError(error.deref());
        throw new aeerrors.ConnectionError(`Can't launch application at ${util.inspect(url('path').toString())}: ${message}`, number);
    }
}


/****************************************************************************************/
// unpack specifiers


function unpackSpecifierRecord(appData, desc, fullyUnpack) {
    switch (desc('descriptorType')) {
    case objc.typeObjectSpecifier:
        const want = desc('descriptorForKeyword', objc.keyAEDesiredClass);
        const form = desc('descriptorForKeyword', objc.keyAEKeyForm);
        var seld = desc('descriptorForKeyword', objc.keyAEKeyData);
        const fromDesc = desc('descriptorForKeyword', objc.keyAEContainer);
        var from;
        if (fullyUnpack) {
            from = unpackSpecifierRecord(appData, fromDesc, true);
        } else { // defer full unpacking until needed (e.g. when formatting for display)
            from = new Proxy({specifierRecord:undefined}, {
                get: function(target, name) {
                    if (target.specifierRecord === undefined) {
                        target.specifierRecord = unpackSpecifierRecord(appData, fromDesc, true);
                    }
                    return target.specifierRecord[name];
                }
            });
        }
        var selectors, call = aeselectors.getDataCommand;
        switch (form('enumCodeValue')) {
        case objc.formPropertyID:
            selectors = appData.propertySpecifierAttributes;
            break;
        case objc.formUserPropertyID:
            seld = appData.unpack(seld);
            selectors = appData.propertySpecifierAttributes;
            break;
        case objc.formAbsolutePosition:
            if (seld('descriptorType') === objc.typeAbsoluteOrdinal) {
                if (seld('typeCodeValue') === objc.kAEAllDesc) { // TO DO: check (probably won't work)
                    selectors = appData.multipleElementsSpecifierAttributes;
                } else {
                    selectors = appData.singleElementSpecifierAttributes;
                }
                break;
            }
        case objc.formName:
        case objc.formUniqueID:
            seld = appData.unpack(seld);
            selectors = appData.singleElementSpecifierAttributes;
            break;
        case objc.formRelativePosition:
            selectors = appData.singleElementSpecifierAttributes;
            break;
        case objc.formRange:
            const start = appData.unpack(desc('descriptorForKeyword', objc.keyAERangeStart), true);
            const stop  = appData.unpack(desc('descriptorForKeyword', objc.keyAERangeStop), true);
            seld = new Range(start, stop, want);
            break;
        case objc.formTest:
            seld = unpackTestDescriptor(appData, seld);
            selectors = appData.multipleElementsSpecifierAttributes;
            break;
        default:
            throw new TypeError(`Malformed object specifier (unknown form): ${desc}`);
        }
        return {from:from,
                want:want,
                form:form,
                seld:seld,
                cachedDesc:desc,
                selectors:selectors,
                call:aeselectors.getDataCommand,
                pack:aeselectors.packCachedDesc};
    case objc.typeNull:
        return aeselectors.newRootSpecifierRecord(appData);
    case objc.typeCurrentContainer:
        return untargetedConRoot.__nodeautomation_specifierRecord__;
    case objc.typeObjectBeingExamined:
        return untargetedItsRoot.__nodeautomation_specifierRecord__;
    default:
        return newCustomRootSpecifierRecord(appData.unpack(desc));
    }
}


function unpackInsertionLocRecord(appData, desc, fullyUnpack) {
    return {from:appData.unpack(desc('descriptorForKeyword', objc.keyAEObject), fullyUnpack),
            seld:desc('descriptorForKeyword', objc.keyAEPosition),
            cachedDesc:desc, 
            selectors:appData.insertionSpecifierAttributes,
            call:doNotCall,
            pack:aeselectors.packCachedDesc};
}


// unpack test clauses

const kComparisonOperatorCodes = [objc.kAELessThan, objc._kAELessThanEquals, objc.kAEEquals, objc.kAEGreaterThan, 
                                  objc.kAEGreaterThanEquals, objc.kAEBeginsWith, objc.kAEEndsWith, objc.kAEContains];
const kLogicalOperatorCodes = [objc.kAEAND, objc.kAEOR, objc.kAENOT];

function unpackComparisonDescriptor(appData, desc) {
    const operatorType = desc('descriptorForKeyword', objc.keyAECompOperator);
    const operand1Desc = desc('descriptorForKeyword', objc.keyAEObject1);
    const operand2Desc = desc('descriptorForKeyword', objc.keyAEObject2);
    if (operatorType && operator1Desc && operator2Desc
                                      && kComparisonOperatorCodes.includes(operatorType('enumCodeValue'))) {
        var operand1 = appData.unpack(operand1Desc);
        var operand2 = appData.unpack(operand2Desc);
        if (operatorType('typeCodeValue') === objc.kAEContains && !aeselectors.isSpecifier(operand1)) { // isIn()
            [operand1, operand2] = [operand2, operand1];
        }
        if (isSpecifier(operand1)) {
            return appData.newSpecifier(appData, {
                    from:operand1.__nodeautomation_specifierRecord__, // left operand
                    form:operatorDesc, // operator
                    seld:operand2, // right operand
                    cachedDesc:desc, 
                    selectors:logicalTestConstructors,
                    call:doNotCall,
                    pack:aeselectors.packCachedDesc});
        }
    }
    throw new TypeError(`Can't unpack comparison test (malformed descriptor): ${desc}`);
}


function unpackLogicalDescriptor(appData, desc) {
    const operatorType = desc('descriptorForKeyword', objc.keyAELogicalOperator);
    const operandsDesc = desc('descriptorForKeyword', objc.keyAEObject);
    if (operatorType && operandsDesc && operandsDesc('descriptorType') === objc.typeAEList
                                     && kLogicalOperatorCodes.includes(operatorType('enumCodeValue'))) {
        const count = operandsDesc('numberOfItems');
        if ((operatorType === objc.kAENOT && count === 1) || count > 1) {
            var operands = [];
            for (var i = 1; i <= count; i++) {
                operands.push(unpackTestDescriptor(operandsDesc('descriptorAtIndex', i)));
            }
            return appData.newSpecifier(appData, {
                    from:operands[0].__nodeautomation_specifierRecord__, // left operand
                    form:operatorDesc, // operator
                    seld:operands.slice(1), // right operand[s]
                    cachedDesc:desc, 
                    selectors:logicalTestConstructors,
                    call:doNotCall,
                    pack:aeselectors.packCachedDesc});
        }
    }
    throw new TypeError(`Can't unpack logical test (malformed descriptor): ${desc}`);
}


function unpackTestDescriptor(appData, desc) {
    switch (operandDesc('descriptorType')) {
    case objc.typeCompDescriptor:
        return unpackComparisonDescriptor(appData, desc);
    case objc.keyAELogicalOperator:
        return unpackLogicalDescriptor(appData, desc);
    default:
        throw new TypeError(`Can't unpack logical test (malformed descriptor): ${desc}`);
    }
}


// unpack QDPoint, QDRectangle, RGBColor

const SINT16_SIZE = 2;
const UINT16_SIZE = 2;

function unpackNumericArray(desc, size, indexes, readFuncName) {
    // note: coercing these types to typeAEList and unpacking those would be simpler, but while AEM provides coercion handlers for coercing e.g. typeAEList to typeQDPoint, it doesn't provide handlers for the reverse (coercing a typeQDPoint desc to typeAEList merely produces a single-item AEList containing the original typeQDPoint, not a 2-item AEList of typeSInt16)
    const data = desc('data');
    var b = Buffer(size * indexes.length);
    data('getBytes', b, 'length', size * indexes.length);
    var result = [];
    for (var i of indexes) { result.push(b[readFuncName](i * size)); }
    return result;
}


/****************************************************************************************/
// APPLICATION DATA
/****************************************************************************************/
// targeted specifiers constain an AppData instance that contains an AEAddressDesc for a specific app along with that app's terminology tables


function AppData(targetType, targetID, options) {
    if (typeof options !== 'object') {
        throw new TypeError(`Bad application options argument (not an object): ${options}`);
    }
    this.workspaceLaunchOptions = (options.launchOptions !== undefined ? readLaunchOptions(options.launchOptions)
                                                                       : kDefaultLaunchOptions);
    this.relaunchMode = (options.autoRelaunch !== undefined ? readRelaunchMode(options.autoRelaunch)
                                                            : kDefaultRelaunchMode);
    switch (typeof options.terminology) {
    case 'object':
        this.terminologyTables = options.terminology;
        break;
    case 'string': // file path
        try {
            this.terminologyTables = JSON.parse(require('fs').readFileSync(options.terminology, 'utf8'));
            if (typeof this.terminologyTables !== 'object') {
                throw new TypeError(`JSON file doesn't contain a terminology object: ${this.terminologyTables}`);
            }
        } catch (e) {
            throw new aeerrors.TerminologyError(
                `Can't read terminology from file ${aeformatter.formatValue(options.terminology)}: ${e}`);
        }
        break;
    case 'undefined':
    case 'null':
        this.terminologyTables = null;
        break;
    default:
        throw new TypeError(`Bad "terminology" value (not an object/string/null): ${options.terminology}`);
    }
    // used by formatter
    this.targetType = targetType;
    this.targetID = targetID;
    this._targetDescriptor = null; // TO DO: [re]connect as necessary; throw on fail
    
    
    this.target = function() {
        if (!this._targetDescriptor) {
            var desc;
            switch (this.targetType) {
            case "named":
                if (typeof this.targetID !== 'string') {
                    throw new TypeError(`app.named(...) requires a name/path string but received ${typeof this.targetID}: ${util.inspect(this.targetID)}`);
                }
                var url = aesupport.fileURLForLocalApplication(this.targetID);
                if (!url) {
                    throw new aeerrors.ConnectionError(`Application not found: ${util.inspect(this.targetID)}`, -10814); // TO DO: not sure about this error number
                }
                desc = processDescriptorForLocalApplication(url, this.workspaceLaunchOptions);
                break;
            case "at": // eppc: URL
                if (typeof this.targetID !== 'string') {
                    throw new TypeError(`app.at(...) requires an "eppc:" URL string but received ${typeof this.targetID}: ${util.inspect(this.targetID)}`);
                }
                var url = objc.NSURL('URLWithString', objc(this.targetID));
                if (!url || url('scheme').toString().toLowerCase() !== 'eppc') {
                    throw new TypeError(`app.at(...) requires an "eppc:" URL but received: ${util.inspect(this.targetID)}`);
                }
                return objc.NSAppleEventDescriptor('descriptorWithApplicationURL', url);
            case "ID":
                switch (typeof this.targetID) {
                case 'string': // bundleIdentifier
                    var error = objc.alloc(objc.NSError, objc.NIL).ref();
                    var runningProcess = objc.NSWorkspace('sharedWorkspace')(
                                                          'launchApplicationWithBundleIdentifier', objc(this.targetID),
                                                          'options', this.workspaceLaunchOptions,
                                                          'configuration', objc.NSDictionary('dictionary'),
                                                          'error', error);
                    if (!runningProcess) {
                        const [message, number] = infoForNSError(error.deref());
                        throw new aeerrors.ConnectionError(`Can't launch application at ${util.inspect(this.targetID)}: ${message}`, number);
                    }
                    desc = objc.NSAppleEventDescriptor('descriptorWithProcessIdentifier',
                                                        runningProcess('processIdentifier'));
                    break;
                case 'number': // ProcessID
                    try {
                        desc = objc.NSAppleEventDescriptor('descriptorWithProcessIdentifier', 
                                                            aesupport.SInt32(this.targetID));
                    } catch(e) { // catch out-of-bounds errors from SInt32()
                        throw new TypeError(`app.ID(...) received bad process ID number: ${this.targetID}`);
                    }
                    break;
                case 'function': // NSAppleEventDescriptor?
                    if (aesupport.isDescriptor(this.targetID)) { return this.targetID; } // caution: it is user's responsibility to ensure supplied descriptor is a valid AEAddressDesc
                default: // else fallthru
                    throw new TypeError(`app.ID(...) requires bundle ID, process ID, or address descriptor but received: ${this.targetID}`);
                }
                break;
            case "currentApplication":
                desc = objc.NSAppleEventDescriptor('currentProcessDescriptor');
                break;
            default:
                throw new TypeError(`Bad target type: "${this.targetType}"`);
            }
            this._targetDescriptor = desc;
            return desc;
        }
        return this._targetDescriptor;
    };
    
    this.isRunning = function() {
        switch (this.targetType) {
        case 'named': // application's name (.app suffix is optional) or full path
            var url = aesupport.fileURLForLocalApplication(this.targetID);
            return Boolean(url && processForLocalApplication(url));
        case 'at': // "eppc" URL
            var url = objc.NSURL('URLWithString', objc(url));
            return isRunningWithAddressDescriptor(objc.NSAppleEventDescriptor('descriptorWithApplicationURL', url));
        case 'ID':
            switch (typeof this.targetID) {
            case 'string': // bundleID
                return objc.NSRunningApplication('runningApplicationsWithBundleIdentifier', 
                                                                               objc(this.targetID))('count') > 0;
            case 'number': // PID
                return Boolean(objc.NSRunningApplication('runningApplicationWithProcessIdentifier', this.targetID));
            default: // AEAddressDesc
                return isRunningWithAddressDescriptor(this.targetID);
            }
        }
        return true; // currentApplication
    };
    
    
    this.isRelaunchable = function() { // only local apps targeted by name/path/bundleID can be automatically relaunched
        return (this.targetType === 'named' || (this.targetType === 'ID' && typeof this.targetID === 'string'));
    };
    
    
    this.isRunningWithAddressDescriptor = function(desc) {
        return !kProcessNotFoundErrorNumbers.includes(this._sendLaunchEvent(desc));
    };

    //
    
    this._sendAppleEvent = function(event, sendOptions, timeoutInSeconds) { // used by sendAppleEvent()
        // returns [null, NSError] on AEM errors (-1712 'event timed out', -600 'process not found', etc)
        // (note: application errors are reported via the reply event, not by AEM)
        var error = objc.alloc(objc.NSError, objc.NIL).ref();
        var replyEvent = event('sendEventWithOptions', sendOptions, 'timeout', timeoutInSeconds, 'error', error);
        return [replyEvent, replyEvent ? null : error.deref()]; // TO DO: is there reliable way to check if NSError** is nilptr?
    };
    
    //
    
    this._sendLaunchEvent = function(processDescriptor) { // returns error code (except -1708, which is ignored)
        const event = objc.NSAppleEventDescriptor('appleEventWithEventClass', objc.kASAppleScriptSuite, 
                                                  'eventID', objc.kASLaunchEvent,
                                                  'targetDescriptor', processDescriptor, 
                                                  'returnID', objc.kAutoGenerateReturnID,
                                                  'transactionID', objc.kAnyTransactionID);
        const [replyEvent, error] = this._sendAppleEvent(event, kSendOptions.waitReply, 30);
        if (!replyEvent) { return error('code'); }
        const errorDesc = replyEvent('paramDescriptorForKeyword', objc.keyErrorNumber);
        // `ascrnoop` events normally return 'handler not found' (-1708) errors, so ignore those
        return (errorDesc && errorDesc('int32Value') !== -1708) ? errorDesc('int32Value') : 0;
    };
    
    // TO DO: `launch` needs a rethink
    
    this.launch = function() { // called by Application.launch()
        // launch this application (equivalent to AppleScript's `launch` command; an obscure corner case that AS users need to fall back onto when sending an event to a Script Editor applet that isn't saved as 'stay open', so only handles the first event it receives then quits when done) // TO DO: is it worth keeping this for 'quirk-for-quirk' compatibility's sake, or just ditch it and tell users to use `NSWorkspace.launchApplication(at:options:configuration:)` with an `NSWorkspaceLaunchConfigurationAppleEvent` if they really need to pass a non-standard first event?
        // note: in principle an app _could_ implement an AE handler for this event that returns a value, but it probably isn't a good idea to do so (the event is called 'ascr'/'noop' for a reason), so even if a running process does return something (instead of throwing the expected errAEEventNotHandled) we just ignore it for sanity's sake (the flipside being that if the app _isn't_ already running then NSWorkspace.launchApplication() will launch it and pass the 'noop' descriptor as the first Apple event to handle, but doesn't return a result for that event, so to return a result at any other time would be inconsistent)
        console.log('is running:', this.isRunning()); // DEBUG
        if (this.isRunning()) {
            const errorNumber = this._sendLaunchEvent(this.target()); // WRONG
            if (errorNumber !== 0) { throw new aeerrors.AppleEventManagerError(errorNumber); } // TO DO: not right
        } else {
            switch (this.targetType) {
            case 'named':
                var url = aesupport.fileURLForLocalApplication(this.targetID);
                if (!url) {
                    throw new aeerrors.ConnectionError(`Can't launch application named ${util.inspect(this.targetID)}: Application not found.`, -10814);
                }
                launchApplicationAtURL(url); // throws on failure
                return;
            case 'at':
                // TO DO: NA doesn't do file URLs and eppc URLs can't launch; all we can do is send it RAE (but need to check if that's what AS does)
                //launchApplicationAtURL(objc.NSURL('URLWithString', objc(this.targetID)));
                throw new Error('TBC');
                return;
            case 'ID':
                if (typeof this.targetID !== 'string') {
                    throw new aeerrors.ConnectionError(`Can't launch application with process ID ${util.inspect(this.targetID)}: Application not found.`, number);
                }
                var url = NSWorkspace('sharedWorkspace')('urlForApplicationWithBundleIdentifier', 
                                                                                objc(this.targetID));
                if (!url) {
                    throw new aeerrors.ConnectionError(`Can't launch application with bundle ID ${util.inspect(this.targetID)}: Application not found.`, -10814);

                }
                launchApplicationAtURL(url);
                return;
            } // fall through on failure
            throw new aeerrors.ConnectionError("Can't launch application.", -10814); // TO DO: what error message/number to use here?
        }
    };
    
    
    /************************************************************************************/
    // AE DISPATCH
    
    this.sendAppleEvent = function(commandDef, parentSpecifierRecord, parametersObject) {
        var replyEvent = null, nsError = null;
        try {
            if (typeof parametersObject !== 'object') {
                throw new TypeError(
                    `Bad command argument: expected a parameters object but received ${typeof parametersObject}.`);
            }
            var directParameter = aesupport.kNoParameter;
            var subjectAttribute = aesupport.kAppRootDesc;
            var timeoutInSeconds = kDefaultTimeout;
            var sendOptions = kDefaultSendOptions, ignoringDescs = kDefaultIgnoringDescriptors;
            var appleEvent = objc.NSAppleEventDescriptor('appleEventWithEventClass', commandDef.eventClass, 
                                                         'eventID', commandDef.eventID, 
                                                         'targetDescriptor', this.target(), 
                                                         'returnID', objc.kAutoGenerateReturnID, 
                                                         'transactionID', objc.kAnyTransactionID);
            for (key in parametersObject) {
                var value = parametersObject[key];
                try {
                    const paramCode = commandDef.params[key];
                    if (paramCode !== undefined) {
                        appleEvent('setParamDescriptor', this.pack(value), 'forKeyword', paramCode);
                    } else {
                        switch(key) {
                        case "_":
                            directParameter = this.pack(value);
                            break;
                        case "asType": // must be keyword
                            if (!aesupport.Keyword.isKeyword(value)) {
                                throw new aeerrors.ParameterError(value, 'Bad asType attribute (not a keyword)');
                            }
                            appleEvent('setParamDescriptor', this.pack(value), 'forKeyword', objc.keyAERequestedType);
                            break;
                        case "sendOptions": // all send flags; [array of] keywords, e.g. [k.ignoreReply,...]
                            sendOptions = readSendOptions(value);
                            break;
                        case "withTimeout": 
                            // caution: -[NSAppleEventDescriptor sendEventWithOptions:timeout:] is buggy: it multiplies timeout in seconds by 60 to get timeout in ticks, but should only do this for non-negative values (negative numbers are flags: 'kAEDefaultTimeout=-1' and 'kNoTimeOut=-2'); therefore we use `null` = default timeout and `0` = no timeout
                            if (value !== null) { // users can pass `null` to indicate default timeout (120sec)
                                try {
                                    timeoutInSeconds = aesupport.SInt32(value);
                                    if (timeoutInSeconds <= 0) { // 'no timeout'
                                        timeoutInSeconds = -2; // fortunately AEM treats any value <= -2 as 'no timeout'
                                    }
                                } catch(e) {
                                    throw new aeerrors.ParameterError(value, 
                                            "Bad timeout attribute (not an integer or null)");
                                }
                            }
                            break;
                        case "ignoring": // text attributes to consider/ignore (if supported by app); [array of] keywords
                            ignoringDescs = readIgnoringOptions(value);
                            break;
                        default: // if four-char code (e.g. '#docu', '0x646f6375') pack as param, else throw 'unknown'
                            var rawParamCode;
                            try {
                                rawParamCode = aesupport.parseFourCharCode(key); 
                            } catch(e) {
                                throw new aeerrors.ParameterError(value, `Unknown parameter/attribute: "${key}"`);
                            }
                            appleEvent('setParamDescriptor', this.pack(value), 'forKeyword', rawParamCode);
                        }
                    }
                } catch (e) {
                    if (!(e instanceof aeerrors.ParameterError)) { // PackError/bugs
                        if (e instanceof aeerrors.PackError) { e = `can't pack ${typeof value} as descriptor`; }
                        e = new aeerrors.ParameterError(value, `Bad "${key}" parameter (${e})`);
                    }
                    throw e;
                }
            }
            // special-case where command os called on a specifier, e.g. SPECIFIER.COMMAND() -> APP.COMMAND(_:SPECIFIER)
            if (parentSpecifierRecord.form !== aesupport.kSpecifierRoot) {
                const parentSpecifierDesc = aeselectors.packSpecifier(this, parentSpecifierRecord);
                if (commandDef.eventClass === objc.kAECoreSuite && commandDef.eventID === objc.kAECreateElement) {
                    // special-case shortcut for `make` (this uses parentSpecifier as `at` instead of direct param)
                    if (!appleEvent('paramDescriptorForKeyword', objc.keyAEInsertHere)) {
                        appleEvent('setParamDescriptor', parentSpecifierDesc, 'forKeyword', objc.keyAEInsertHere);
                    } else {
                        subjectAttribute = parentSpecifierDesc;
                    }
                } else {
                    if (directParameter === aesupport.kNoParameter) {
                        directParameter = parentSpecifierDesc;
                    } else {
                        subjectAttribute = parentSpecifierDesc;
                    }
                }
            }
            if (directParameter !== aesupport.kNoParameter) {
                appleEvent('setParamDescriptor', directParameter, 'forKeyword', objc.keyDirectObject);
            }
            const [enumConsiderations, enumConsidsAndIgnores] = ignoringDescs;
            appleEvent('setAttributeDescriptor', enumConsiderations, 'forKeyword', objc.enumConsiderations);
            appleEvent('setAttributeDescriptor', enumConsidsAndIgnores, 'forKeyword', objc.enumConsidsAndIgnores);
            appleEvent('setAttributeDescriptor', subjectAttribute, 'forKeyword', objc.keySubjectAttr);
            // send the AppleEvent
            [replyEvent, nsError] = this._sendAppleEvent(appleEvent, sendOptions, timeoutInSeconds);
            // console.log('SENT EVENT:',appleEvent, '\nREPLY EVENT:',replyEvent, '\nAEM ERROR:',nsError); // DEBUG
            // check for errors raised by Apple Event Manager (e.g. timeout, process not found)
            if (!replyEvent) {
                if (kRelaunchableErrorCodes.includes(nsError('code')) && this.isRelaunchable() 
                        && (this.relaunchMode === kRelaunchModes.alwaysRelaunch
                               || (this.relaunchMode === kRelaunchModes.limitedRelaunch 
                                && kLimitedRelaunchEvents.includes([eventClass, eventID])))) {
                    // event failed as target process has quit since previous event; recreate AppleEvent with new a address descriptor and resend
                    this._targetDescriptor = null; // discard the old AEAddressDesc
                    const oldAppleEvent = appleEvent;
                    appleEvent = objc.NSAppleEventDescriptor('appleEventWithEventClass', commandDef.eventClass, 
                                                             'eventID', commandDef.eventID, 
                                                             'targetDescriptor', this.target(), 
                                                             'returnID', objc.kAutoGenerateReturnID, 
                                                             'transactionID', objc.kAnyTransactionID);
                    for (var i = 1; i <= event.numberOfItems; i++) {
                        appleEvent('setParamDescriptor', oldAppleEvent('descriptorAtIndex', i), 
                                   'forKeyword', oldAppleEvent('keywordForDescriptorAtIndex', i));
                    }
                    for (var key of [objc.keySubjectAttr, objc.enumConsiderations, objc.enumConsidsAndIgnores]) {
                        appleEvent('setAttributeDescriptor', oldAppleEvent('attributeDescriptorForKeyword', key),
                                   'forKeyword', key);
                    }
                    [replyEvent, nsError] = this._sendAppleEvent(appleEvent, sendOptions, timeoutInSeconds);
                }
                if (!replyEvent) { throw new aeerrors.AppleEventManagerError(nsError('code')); }
            }
            return this.unpackReplyEvent(replyEvent, sendOptions);
        } catch (parentError) { // rethrow all errors as CommandError
            throw new aeerrors.CommandError(this, commandDef, parentSpecifierRecord, parametersObject, parentError);
        }
    };
    
    
    this.unpackReplyEvent = function(replyEvent, sendOptions) { // unpack application error/result, if any
        // To return raw reply events, construct `app` object as normal then patch its AppData as follows:
        //
        //   const someApp = app(...);
        //   someApp.__nodeautomation_appData__.unpackReplyEvent = function(replyEvent,sendOptions){return replyEvent;};
        //   var replyEvent = someApp.someCommand(...); // -> <NSAppleEventDescriptor: 'aevt'\'ansr'{...}>
        //
        if (sendOptions & kSendOptions.waitReply) {
            const errorNumberDesc = replyEvent('paramDescriptorForKeyword', objc.keyErrorNumber);
            if (errorNumberDesc && errorNumberDesc('int32Value') !== 0) { // an application error occurred
                throw new aeerrors.ApplicationError(this, replyEvent);
            } else {
                const resultDesc = replyEvent('paramDescriptorForKeyword', objc.keyDirectObject);
                if (resultDesc) { return this.unpack(resultDesc); }
            } // no return value or error, so fall through
        } else if (sendOptions & kSendOptions.queueReply) { // return the returnID attribute that the reply event will use to identify itself when it arrives in host process's event queue (note: this design may change if implementing async callbacks)
            const returnIDDesc = event('attributeDescriptorForKeyword', objc.keyReturnIDAttr);
            if (!returnIDDesc) { // sanity check
                throw new aeerrors.ParameterError(null, "Can't get keyReturnIDAttr from reply event");
            }
            return this.unpack(returnIDDesc);
        }
        return null; // application returned no result
    };

    
    /************************************************************************************/
    // PACK/UNPACK
    
    // Note: object specifiers returned by app are normally lazily unpacked for efficiency (the topmost objspec is unpacked, and a Proxy object containing the rest of the specifier is stored in its "from" slot, to be unpacked only if needed, e.g. for display purposes). This differs from AS's unpacking behavior (AS fully unpacks object specifiers and does not cache the returned descriptor for reuse, so must fully repack them on next use), so in very rare cases (e.g. iView Media Pro) might cause app compatibility problems. To fully unpack and repack object specifiers (slower, but mimics AS's own behavior), override AppData.newSpecifier() to recursively set specifier records' cachedDesc slots to null before passing the records to aeselectors.newSpecifier.
    this.newSpecifier = aeselectors.newSpecifier;
    
    // Note: to pack/unpack unknown JS values/AEDescs, monkey-patch the pack/unpack methods below to process those types first before delegating to original pack/unpack methods.

    this.pack = function(value) {
        if (value === undefined) {
            throw new aeerrors.PackError(value);
        } else if (value === null) {
            return kMissingValueDescriptor;
        } 
        switch (typeof value) {
        case "boolean":
            return objc.NSAppleEventDescriptor('descriptorWithBoolean', value);
        case "number": // TO DO: NaN, Infinity, etc?
            return objc.NSAppleEventDescriptor(
                    (aesupport.isSInt32(value) ? 'descriptorWithInt32' : 'descriptorWithDouble'), value);
        case "string":
            return objc.NSAppleEventDescriptor('descriptorWithString', objc(value));
        }
        if (value.__nodeautomation_pack__ !== undefined) { // value is self-packing, given a targeted AppData instance
            return value.__nodeautomation_pack__(this);
        } else if (Array.isArray(value)) {
            const desc = objc.NSAppleEventDescriptor('listDescriptor');
            for (var item of value) { desc('insertDescriptor', this.pack(item), 'atIndex', 0); }
            return desc;
        } else if (value instanceof Date) {
            return objc.NSAppleEventDescriptor('descriptorWithDate', objc(value));
        } else if (typeof value === 'object') { // assume any object that isn't of a known type (specifier, keyword, file, date, etc) is a record and pack accordingly (if it isn't, this'll likely throw on encountering unknown keys; it's user's job to figure out where that object came from and why it got passed to here when it shouldn't have been)
            var recordDesc = objc.NSAppleEventDescriptor('recordDescriptor');
            var isCustomRecordType = false, customType = value['class'];
            if (customType === undefined) { customType = value["#pcls"]; }
            if (customType === undefined) { customType = value[objc.pClass]; } // 0x70636c73
            if (customType !== undefined && aesupport.isKeyword(customType)) { // 'class' property contains a type name?
                const typeCode = customType.__nodeautomation_pack__(this)('typeCodeValue');
                recordDesc = recordDesc('coerceToDescriptorType', typeCode);
                isCustomRecordType = true;
            }
            var userFieldsDesc = null;
            for (var key in value) {
                try {
                    if (isCustomRecordType && (key === 'class' || objc.pClass == key)) { continue; }
                    const valueDesc = this.pack(value[key]);
                    var keyCode = this.typeCodeByName(key);
                    if (keyCode === undefined) {
                        if (key.startsWith('$')) {
                            if (!userFieldsDesc) { userFieldsDesc = objc.NSAppleEventDescriptor('listDescriptor'); }
                            const keyDesc = objc.NSAppleEventDescriptor('descriptorWithString', objc(key.substr(1)));
                            userFieldsDesc('insertDescriptor', keyDesc, 'atIndex', 0);
                            userFieldsDesc('insertDescriptor', valueDesc, 'atIndex', 0);
                            continue; // skip to next key
                        } else {
                            keyCode = aesupport.parseFourCharCode(key); // throws if not a valid four-char code
                        }
                    }
                    recordDesc('setDescriptor', valueDesc, 'forKeyword', keyCode);
                } catch(e) {
                console.log(e)
                    throw new aeerrors.PackError(value, `Can't pack "${key}" property of record: ${e}`);
                }
            }
            if (userFieldsDesc) {
                recordDesc('setDescriptor', userFieldsDesc, 'forKeyword', objc.keyASUserRecordFields);
            }
            return recordDesc;
        } else if (aesupport.isDescriptor(value)) {
            return value;
        }
        throw new aeerrors.PackError(value);
    };
    
    this.unpack = function(desc, fullyUnpack = false) {
        switch (desc('descriptorType')) {
        case objc.typeFalse:
        case objc.typeTrue:
        case objc.typeBoolean:
            return Boolean(desc('booleanValue'));
        case objc.typeUnicodeText:
        case objc.typeChar:
        case objc.typeIntlText:
        case objc.typeUTF8Text:
        case objc.typeUTF16ExternalRepresentation:
        case objc.typeStyledText:
        case objc.typeVersion:
            const nsString = desc('stringValue');
            if (!nsString) { throw new aeerrors.UnpackError(desc, "Can't unpack malformed string descriptor"); }
            return nsString.toString();
        case objc.typeSInt32:
        case objc.typeSInt16:
        case objc.typeUInt16:
            return desc('int32Value');
        case objc.typeUInt32:
        case objc.typeSInt64: // caution: lossy precision
        case objc.typeUInt64: // caution: lossy precision
        case objc.typeIEEE32BitFloatingPoint:
        case objc.typeIEEE64BitFloatingPoint:
            return desc('doubleValue');
        case objc.type128BitFloatingPoint: // caution: lossy precision
            const doubleDesc = desc('coerceToDescriptorType', objc.typeIEEE64BitFloatingPoint);
            if (!doubleDesc) { throw new aeerrors.UnpackError(desc, "Can't coerce 128-bit float to double"); }
            return doubleDesc('doubleValue');
        case objc.typeAEList:
            var result = [];
            for (var i = 1; i <= desc('numberOfItems'); i++) {
                result.push(this.unpack(desc('descriptorAtIndex', i)));
            }
            return result;
        case objc.typeAERecord:
            return this.unpackAERecord(desc);
        case objc.typeLongDateTime:
            const nsDate = desc('dateValue');
            if (!nsDate) { throw new aeerrors.UnpackError(desc, "Can't unpack malformed date descriptor"); }
            return new Date(nsDate);
        case objc.typeObjectSpecifier:
            return this.newSpecifier(this, unpackSpecifierRecord(this, desc, fullyUnpack));
        case objc.typeInsertionLoc:
            return this.newSpecifier(this, unpackInsertionLocRecord(appData, desc, fullyUnpack));
        // keywords
        case objc.typeType:
        case objc.typeProperty:
        case objc.typeKeyword:
            var code = desc('typeCodeValue');
            if (code === objc.cMissingValue) { return null; } // make exceptions for cMissingValue (return null)
            var name = this.typeNameByCode(code);
            return (name ? new aesupport.Keyword(name) : new aesupport.Keyword(null, desc));
        case objc.typeEnum:
            var name = this.typeNameByCode(desc('enumCodeValue'));
            return (name ? new aesupport.Keyword(name) : new aesupport.Keyword(null, desc));
        // file types
        case objc.typeAlias:
        case objc.typeFileURL:
        case objc.typeFSRef: // note: typeFSS is long deprecated so don't bother with that; Alias and FSRef Carbon APIs are also deprecated but the corresponding AE types still persist
        case objc.typeBookmarkData: // may be problematic/buggy
            return new aesupport.File(desc('fileURLValue')('path').toString()); // TO DO: what about caching/roundtripping original descriptor? (there are pros and cons to this, e.g. potentially better compatibility with quirky old Carbon apps vs opaque differences in behavior between alis/bmrk and furl/fsrf. TBH roundtripping compatibility is probably less of a concern now than it was a decade ago, so for now probably best to go with 'dumb' path-only File objects that always use typeFileURL descriptors)
        case objc.typeNull:
            return aeselectors.newRootSpecifier(this);
        case objc.typeCurrentContainer:
            return conRoot;
        case objc.typeObjectBeingExamined:
            return itsRoot;
        // AEDescs used by older Carbon apps, e.g. Finder windows (Cocoa apps use lists)
        // caution: Buffer doesn't provide methods for reading with native endianness, so these are currently hardcoded as LE (i386/x86_64)
        case objc.typeQDPoint:
            return unpackNumericArray(desc, SINT16_SIZE, [1,0], 'readInt16LE');
        case objc.typeQDRectangle:
            return unpackNumericArray(desc, SINT16_SIZE, [1,0,3,2], 'readInt16LE');
        case objc.typeRGBColor:
            return unpackNumericArray(desc, UINT16_SIZE, [0,1,2], 'readUInt16LE');
        }
        return desc('isRecordDescriptor') ? this.unpackAERecord(desc) : desc;
    };
    
    this.unpackAERecord = function(desc) {
        var result = {};
        const customTypeCode = desc('descriptorType');
        if (customTypeCode !== objc.typeAERecord) {
            var name = this.typeNameByCode(customTypeCode);
            result.class = (name ? new aesupport.Keyword(name) : Keyword.fromTypeCode(customTypeCode));
        }
        for (var i = 1; i <= desc('numberOfItems'); i++) {
            const key = desc('keywordForDescriptorAtIndex', i), valueDesc = desc('descriptorAtIndex', i);
            if (key === objc.keyASUserRecordFields) {
                if (valueDesc('descriptorType') !== objc.typeAEList || valueDesc('numberOfItems') % 2 !== 0) {
                    throw new aeerrors.UnpackError(desc, "Malformed AERecord descriptor"); // sanity check
                }
                for (var j = 1; j <= valueDesc('numberOfItems'); j += 2) {
                    const keyString = valueDesc('descriptorAtIndex', j)('stringValue');
                    if (keyString === null) { throw new aeerrors.UnpackError(desc, "Malformed AERecord descriptor"); }
                    result['$'+keyString] = this.unpack(valueDesc('descriptorAtIndex', j+1));
                }
            } else {
                const name = this.typeNameByCode(key);
                result[name || aesupport.formatFourCharString(key)] = this.unpack(valueDesc);
            }
        }
        return result;
    };
    
    /************************************************************************************/
    // TERMINOLOGY TABLES
    
    // caution: these tables are lazily initialized, so always access via the lookup functions below, never directly
    
    this._typeDescriptorsByName = {};
    this._propertyDescriptorsByName = {};
    this._elementsDescriptorsByName = {};
    
    // stub methods load terminology and replace themselves with the real lookup methods on first use
    
    // pack/unpack keywords
    
    this.typeDescriptorByName = function(name) { // used to pack keyword objects
        return _loadTerminology(this).typeDescriptorByName(name);
    };
    
    this.typeCodeByName = function(name) { // used to look up property keys
        return _loadTerminology(this).typeCodeByName(name);
    };
    
    this.typeNameByCode = function(code) { // used to unpack keyword objects
        return _loadTerminology(this).typeNameByCode(code);
    };
    
    // pack/unpack specifiers
    
    this.propertyDescriptorByName = function(name) {
        return _loadTerminology(this).propertyDescriptorByName(name);
    };
    
    this.propertyNameByCode = function(code) {
        return _loadTerminology(this).propertyNameByCode(code);
    };
    
    this.elementsDescriptorByName = function(name) {
        return _loadTerminology(this).elementsDescriptorByName(name);
    };
    
    this.elementsNameByCode = function(code) {
        return _loadTerminology(this).elementsNameByCode(code);
    };
    
    // pack/unpack Apple event
    
    this.commandDefinitionByName = function(name) {
        return _loadTerminology(this).commandDefinitionByName(name);
    };
    
    this.commandDefinitionByCode = function(eventClass, eventID) {
        return _loadTerminology(this).commandDefinitionByCode(eventClass, eventID);
    };
    
    // SELECTOR TABLES; these supply specifier proxies with valid selector methods according to what they specify
    // (property/single element/multiple elements/insertion; plus comparison+containment/logic tests)
    Object.assign(this, aeselectors.targetedAppRootTables);
}


/****************************************************************************************/

const _terminologyAccessors = { // these will be bound to AppData the first time terminology lookup is performed, replacing stub terminology lookup methods

    typeDescriptorByName: function(name) { // used to pack keyword objects; throws Error if not found
        var desc = this._typeDescriptorsByName[name];
        if (!desc) {
            const typeDef = this._typesByName[name]; // {name:[descriptorConstructorName,code],...}
            if (!typeDef) { throw new Error(`Unknown type/enum/property name: "${name}"`); } // TO DO: error type?
            desc = this._typeDescriptorsByName[name] = objc.NSAppleEventDescriptor(typeDef[0], typeDef[1]);
        }
        return desc;
    },
    
    typeCodeByName: function(name) { // string -> OSType/undefined; used to look up property keys
        const typeDef = this._typesByName[name];
        return typeDef ? typeDef[1] : undefined;
    },
    
    typeNameByCode: function(code) { // OSType -> string/undefined; used to unpack keyword objects
        return this._typesByCode[code];
    },
    
    // pack/unpack specifiers
    
    propertyDescriptorByName: function(name) { // string -> descriptor/undefined; used to pack object specifiers
        var desc = this._propertyDescriptorsByName[name];
        if (!desc) {
            const code = this._propertiesByName[name];
            if (code === undefined) { return undefined; }
            this._propertyDescriptorsByName[name] = desc = objc.NSAppleEventDescriptor('descriptorWithTypeCode', code);
        }
        return desc;
    },
    
    propertyNameByCode: function(code) { // OSType -> string/undefined // TO DO: what if it's an ambiguous term that's used as both property and elements name, in which case it needs disambiguated
        return this._propertiesByCode[code];
    },
    
    elementsDescriptorByName: function(name) { // string -> descriptor/undefined; used to pack object specifiers
        var desc = this._elementsDescriptorsByName[name];
        if (!desc) {
            const code = this._elementsByName[name];
            if (code === undefined) { return undefined; }
            this._elementsDescriptorsByName[name] = desc = objc.NSAppleEventDescriptor('descriptorWithTypeCode', code);
        }
        return desc;
    },
    
    elementsNameByCode: function(code) { // OSType -> string/undefined // TO DO: as above
        return this._elementsByCode[code];
    },
    
    // pack/unpack Apple event
    // command definition is object of form: {name:STRING,eventClass:OSTYPE,eventID:OSTYPE,params:{NAME:CODE,...}}
    
    commandDefinitionByName: function(name) { // string -> Object/undefined; used to construct AppleEvent descriptor
        return this._commandsByName[name];
    },
    
    commandDefinitionByCode: function(eventClass, eventID) { // OSType -> Object/undefined
        for (var term of this._commandsByName) {
            if (term.eventClass === eventClass && term.eventID === eventID) { return term; }
        }
        return undefined;
    },
};


function _loadTerminology(appData) { // TO DO: need to merge this into target as it may launch process, in which case we don't want to launch it a second time if 'new instance' flag is set
    var glueTable;
    if (appData.terminologyTables === null) {
        var url;
        switch (appData.targetType) {
        case "named":
            url = aesupport.fileURLForLocalApplication(appData.targetID);
            if (!url) { throw new Error(`Application not found: ${appData.targetID}`); }
            break;
        case "at": // eppc: URL
            url = appData.targetID;
            break;
        case "ID":
            switch (typeof appData.targetID) {
            case 'string': // bundleIdentifier
                var appPath = objc.NSWorkspace('sharedWorkspace')('absolutePathForAppBundleWithIdentifier', 
                                                                                    objc(appData.targetID));
                if (!appPath) { throw new Error(`Can't find ${appData.targetID}: ${error}`); }
                url = objc.NSURL('fileURLWithPath', appPath);
                break;
            case 'number': // ProcessID
                var runningProcess;
                try {
                    runningProcess = objc.NSRunningApplication('runningApplicationWithProcessIdentifier', 
                                                                                aesupport.SInt32(appData.targetID));
                } catch(e) {
                    throw new Error(`app.ID(...) received bad process ID number: ${appData.targetID}`);
                }
                if (!runningProcess) { 
                    throw new Error(`Can't find running application with PID ${appData.targetID}: ${error}`);
                }
                url = runningProcess('bundleURL');
                break;
            case 'function': // NSAppleEventDescriptor?
                if (aesupport.isDescriptor(appData.targetID)) {
                    // caution: problem here is that we can't send ascr/gsdf event as macOS bugs prevent a valid SDEF data being returned if app bundle doesn't contain an .sdef file (i.e. the standard «event ascrgsdf» handler should be smart enough to automatically transcode AETE/.scriptTerminology if that's what app uses, but it doesn't, e.g. TextEdit uses old-style .scriptTerminology so «event ascrgsdf» returns 'resource not found' error, making it effectively useless)
                    throw new Error(`Can't automatically retrive terminology when targeting app by AEAddressDescriptor ${appData.targetID}; supply a static terminology object instead.`);
                } // caution: it is user's responsibility to ensure supplied descriptor is a valid AEAddressDesc
            default: // else fallthru
                throw new TypeError(`app.ID(...) requires bundle ID, process ID, or address descriptor but received: ${appData.targetID}`);
            }
            break;
        case "currentApplication":
            desc = objc.NSAppleEventDescriptor('currentProcessDescriptor');
            break;
        default:
            throw new TypeError(`Bad target type: "${appData.targetType}"`);
        }
        glueTable = aegluetable.glueTableForApplication(url);
    } else {
        glueTable = new aegluetable.GlueTable();
        try {
            glueTable.addTerminology(appData.terminologyTables);
        } catch (e) {
            throw new TypeError(`Invalid "terminologyTables" value: ${e}`);
        }
    }
    appData._typesByName = glueTable.typesByName;
    appData._typesByCode = glueTable.typesByCode;
    appData._propertiesByName = glueTable.propertiesByName;
    appData._propertiesByCode = glueTable.propertiesByCode;
    appData._elementsByName = glueTable.elementsByName;
    appData._elementsByCode = glueTable.elementsByCode;
    appData._commandsByName = glueTable.commandsByName;
    Object.assign(appData, _terminologyAccessors);
    return appData;
}


/****************************************************************************************/
// untargeted specifiers contain a minimal AppData object that does not contain an application address or terminology,
// so can only be used in other (targeted) specifiers and commands; this enables a more elegant query-building API


function UntargetedAppData(selectortables) {
    
    // used by formatter
    this.targetType = null; // named/ID/at/currentApplication
    this.targetID = null;
    
    // used by formatter when untargeted specifiers render themselves
    this.typeCodeByName = this.typeNameByCode = function(v) { return undefined; };
    this.propertyDescriptorByName = this.propertyNameByCode = function(v) { return undefined; };
    this.elementsDescriptorByName = this.elementsNameByCode = function(v) { return undefined; };
    this.commandDefinitionByName = this.commandDefinitionByCode = function(v) { return undefined; };
        
    Object.assign(this, selectortables);
}


const untargetedAppRoot = aeselectors.newRootSpecifier(new UntargetedAppData(aeselectors.untargetedAppRootTables));
const untargetedConRoot = aeselectors.newRootSpecifier(new UntargetedAppData(aeselectors.untargetedConRootTables));
const untargetedItsRoot = aeselectors.newRootSpecifier(new UntargetedAppData(aeselectors.untargetedItsRootTables));


/****************************************************************************************/


module.exports = {
    AppData:AppData, 
    untargetedAppRoot:untargetedAppRoot,
    untargetedConRoot:untargetedConRoot,
    untargetedItsRoot:untargetedItsRoot,
};


