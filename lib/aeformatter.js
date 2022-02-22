#!/usr/bin/env node

'use strict';

// aeformatter

const util = require('util');

const objc = require('objc');

const aesupport = require('./aesupport');
const kae = require('./kae');


/****************************************************************************************/


function _formatAppRoot(appData) {
    if (appData.targetType === null) { return 'app'; } // TO DO: also return "app" if nested
    const methodName = appData.targetType === 'named' ? '' : `.${appData.targetType}`;
    return `app${methodName}(${formatValue(appData.targetID, appData)})`;
}


function formatSpecifierRecord(appData, specifierRecord) { // TO DO: pass flag to indicate nesting
    // TO DO: trap all errors and return opaque object representation with error description comment
    if (specifierRecord === undefined || typeof specifierRecord !== 'object' || specifierRecord.constructor.name !== 'Object') { 
        console.log('<BUG (specifierRecord = ${util.inspect(specifierRecord)})>' )
        //process.exit()
        return '<BUG (specifierRecord = ${util.inspect(specifierRecord)})>' 
    } // DEBUG; TO DO: delete
    if (specifierRecord.form === aesupport.kSpecifierRoot) { // app root; format application using appData info
        switch (specifierRecord.cachedDesc.descriptorType()) {
        case kae.typeNull:
            return _formatAppRoot(appData);
        case kae.typeCurrentContainer:
            return 'con';
        case kae.typeObjectBeingExamined:
            return 'its';
        default:
            return `${_formatAppRoot(appData)}.customRoot(${formatValue(specifierRecord.seld)})`;
        }
    }
    
    
    // TO DO: doesn't seem to have cases for insertionloc: beginning/end/before/after!!!
    
    
    // TO DO: review rest of this function, making sure it formats targeted and untargeted specifiers correctly
    // recursively format specifier record chain, calling formatValue() to format selector args, etc.
    var parent = formatSpecifierRecord(appData, specifierRecord.from);
    // targeted specifier
    const seld = specifierRecord.seld;
    // insertion locs are objects of form: {from:specifier object, seld:typeEnumerated descriptor}
    if (!specifierRecord.form) {
        switch(seld.enumCodeValue()) {
        case kae.kAEBeginning:  return `${parent}.beginning`;
        case kae.kAEEnd:        return `${parent}.end`;
        case kae.kAEBefore:     return `${parent}.before`;
        case kae.kAEAfter:      return `${parent}.after`;
        default:                return `${parent}.<${seld}>`;
        }
    }
    let form = specifierRecord.form.enumCodeValue();
    const want = specifierRecord.want;
    switch (form) {
    case kae.formPropertyID: // specifier.NAME or specifier.property(CODE)
        // (note: untargeted property specifiers are always stored as formAbsolutePosition, never formPropertyID, so this case only ever applies on targeted specifiers)
        const propertyCode = seld.typeCodeValue();
        // TO DO: what if it's an ambiguous term that's used as both property and elements name, in which case it needs disambiguated
        return `${parent}.${(appData.propertyNameByCode(propertyCode)
                            || `.property(${aesupport.formatFourCharString(propertyCode)})`)}`;
    case kae.formUserPropertyID: // specifier.$NAME
        return `${parent}.$${pname}`;
    case kae.formRelativePosition: // specifier.before/after(SYMBOL)
        var methodName, typeName;
        switch (seld.enumCodeValue()) {
        case kae.kAEPrevious:
            methodName = 'previous';
            break;
        case kae.kAENext:
            methodName = 'next';
            break;
        default:
            throw new TypeError(`Bad relative position selector: ${seld}`);
        }
        if (want) { // NSAppleEventDescriptor (previous/next element's type) // TO DO: this was ==function
            const code = want.typeCodeValue();
            if (specifierRecord.from.want.typeCodeValue() === code) { // TO DO: confirm from.want can never be null
                typeName = ''; // omit selector arg if unneeded, e.g. `words[1].next()`, not `words[1].next(k.word)`
            } else {
                const name = appData.elementsNameByCode(code);
                typeName = (name ? `k.${name}` : `k.fromTypeCode(${aesupport.formatFourCharString(code)})`);
            }
        } else { // untargeted specifier; 'want' is keyword's name
            typeName = (specifierRecord.from.want === want) ? '' : want;
        }
        return `${parent}.${methodName}(${typeName})`;
    case kae.kAELessThan:
        return `${parent}.lessThan(${formatValue(seld)})`;
    case kae.kAELessThanEquals:
        return `${parent}.lessOrEqual(${formatValue(seld)})`;
    case kae.kAEEquals:
        const packNotEquals = require('./aeselectors').packNotEqualsTest;
        return `${parent}.${specifierRecord.pack === packNotEquals ? "notEqualTo" : "equalTo"}(${formatValue(seld)})`;
    case kae.kAEGreaterThan:
        return `${parent}.moreThan(${formatValue(seld)})`;
    case kae.kAEGreaterThanEquals:
        return `${parent}.moreOrEqual(${formatValue(seld)})`;
    case kae.kAEBeginsWith:
        return `${parent}.beginsWith(${formatValue(seld)})`;
    case kae.kAEEndsWith:
        return `${parent}.endsWith(${formatValue(seld)})`;
    case kae.kAEContains:
        const packIsIn = require('./aeselectors').packIsInTest;
        return `${parent}.${ specifierRecord.pack === packIsIn ? "isIn" : "contains"}(${formatValue(seld)})`;
    case kae.kAEAND:
        return `${parent}.and(${seld.map(function(item) { return formatValue(item) }).join(", ")})`;
    case kae.kAEOR:
        return `${parent}.or(${seld.map(function(item) { return formatValue(item) }).join(", ")})`;
    case kae.kAENOT:
        return `${parent}.not`;
    }
    // untargeted specifiers store the property/elements name as string in 'want' slot, and convert it to four-char code upon being packed into an Apple event, at which time the target app's AppData instance containing the necessary terminology tables is supplied via [aesupport.__packSelf]()
    if (want instanceof aesupport.UntargetedWantValue) {
        parent = `${parent}.${want.name}`;
    } else { // NSAppleEventDescriptor (element[s] type) // TO DO: was =='function'
        const elementsCode = want.typeCodeValue();
        var elementsName = appData.elementsNameByCode(elementsCode);
        parent += (elementsName ? `.${elementsName}` : `.elements(${aesupport.formatFourCharString(elementsCode)})`);
    }
    switch (form) {
    case kae.formAbsolutePosition: // specifier.at(IDX)/first/middle/last/any
        if (aesupport.isDescriptor(seld) && seld.descriptorType() === kae.typeAbsoluteOrdinal) {
            switch (seld.typeCodeValue()) {
            case kae.kAEFirst:
                return `${parent}.first`;
            case kae.kAEMiddle:
                return `${parent}.middle`;
            case kae.kAELast:
                return `${parent}.last`;
            case kae.kAEAny:
                return `${parent}.any`;
            case kae.kAEAll:
                return `${parent}`;
            default:
            throw new TypeError(`Bad absolute ordinal selector: ${seld}`);
            }
        } else {
            return `${parent}.at(${formatValue(seld)})`;
        } // TO DO: check this and other code that prints seld: is it unpacked or desc?
    case kae.formName: // specifier[NAME] or specifier.named(NAME)
        return `${parent}.named(${formatValue(seld)})`;
    case kae.formUniqueID: // specifier.ID(UID)
        return `${parent}.ID(${formatValue(seld)})`;
        
    case kae.formRange: // specifier.thru(FROM,TO)
        // TO DO: show start/stop in shorthand form if their want is same as parent.want and they're absolute numeric index or name string
        return `${parent}.thru(${formatValue(seld.start)}, ${formatValue(seld.stop)})`;
    case kae.formTest: // specifier.where(TEST)
        return `${parent}.where(${formatValue(seld)})`;
    }
    throw new TypeError(`Invalid specifier form: ${specifierRecord.form}`);
}


function formatValue(value) {

    //console.log(`aeformatter.formatValue ${typeof value === 'object' ? value.constructor.name : typeof value}`)

    if (value === null) {
        return 'null';
    } else if (value[aesupport.__packSelf] !== undefined) { // Specifier/Keyword/File
        return String(value);
    } else if (value instanceof Date) {
        return `new Date(${util.inspect(value)})`; // util.inspect() annoyingly doesn't return a JS literal string
    } else if (value instanceof Array) {
        return `[${value.map(formatValue).join(', ')}]`;
    } else if (typeof value === 'function' || objc.isObject(value)) { // TO DO
        console.log(`Warning: nodeautomation's formatValue() received an unsupported ${typeof value}: ${value}`); // DEBUG
    } // TO DO: any other objects need special handling? (e.g. will util.inspect() be sufficient for formatting AE records?)
    return util.inspect(value);
}


function formatCommand(appData, commandDef, parentSpecifierRecord, parametersObject) {
    var result = formatSpecifierRecord(appData, parentSpecifierRecord);
    if (commandDef.name) {
        result += `.${commandDef.name}(`;
    } else {
        result += `.sendAppleEvent(${aesupport.formatFourCharString(commandDef.eventClass)}, ${aesupport.formatFourCharString(commandDef.eventID)}, `;
    }
    // TO DO: rework the following to format numeric keys as four-char strings
    var hasParams = false;
    for (var k in parametersObject) { hasParams = true; }
    return `${result}${(hasParams ? formatValue(parametersObject) : '')})`;
}


// TO DO: formatAppleEvent(appleEvent) { ... } // note: this needs to get AEAddressDesc and coerce it to typeKernelProcessID, throwing on failure; the PID is then used to get app bundle's full path and file name (the latter is used to look up app bundle path in Launch Services; if both paths are same then only app name need be shown, not full path); pass the name/path to app(...), then get its AppData instance and use that to unpack attrs and params and get commanddef, and reconstruct command's literal JS syntax from there

function applicationPathForAddressDescriptor(addressDesc) { // NSAppleEventDescriptor -> string
    if (addressDesc.descriptorType() === kae.typeProcessSerialNumber) { // AppleScript is old school
        addressDesc = addressDesc.coerceToDescriptorType_(kae.typeKernelProcessID);
    }
    if (!addressDesc || addressDesc.descriptorType() !== kae.typeKernelProcessID) { // local processes are generally targeted by PID
        throw new TypeError(
                `Unsupported address type: ${aesupport.formatFourCharString(addressDesc.descriptorType())}`);
    }
    const b = Buffer.alloc(4); // pid_t
    addressDesc.data().getBytes_length_(b, 4);
    const pid = b.readInt32LE();
    const process = objc.NSRunningApplication.runningApplicationWithProcessIdentifier_(pid);
    if (!process) { throw new Error(`Can't find application process (PID: ${pid}).`); }
    const applicationURL = process.bundleURL();
    if (!applicationURL) { throw new Error("Can't get path to application bundle (PID: \(pid))."); }
    return objc.js(applicationURL.path());
}


function formatAppleEvent(appleEvent) {
    if (!(aesupport.isDescriptor(appleEvent) && appleEvent.descriptorType() === kae.typeAppleEvent)) {
        throw new TypeError(`formatAppleEvent() expected Apple event descriptor but received: ${appleEvent}`);
    }
    const aeappdata = require("./aeappdata");
    const aeselectors = require('./aeselectors');
    const addressDesc = appleEvent.attributeDescriptorForKeyword_(kae.keyAddressAttr);
    const applicationPath = applicationPathForAddressDescriptor(addressDesc);
    // TO DO: check if full applicationPath === LaunchServices path for app's file name; if true, pass name only here
    const appData = new aeappdata.AppData("named", applicationPath, {});
    const eventClass = appleEvent.attributeDescriptorForKeyword_(kae.keyEventClassAttr).typeCodeValue();
    const eventID = appleEvent.attributeDescriptorForKeyword_(kae.keyEventIDAttr).typeCodeValue();
    // TO DO: what about kAECoreSuite/kASSubroutineEvent? format keyASSubroutineName as $NAME
    const commandDef = appData.commandDefinitionByCode(eventClass, eventID);
    var paramsByCode = {};
    if (commandDef) { for (var k in commandDef.params) { paramsByCode[commandDef.params[k]] = k; } }
    var directParam = undefined, params = [], subject = undefined;
    for (var i = 1; i <= appleEvent.numberOfItems(); i++) {
        var value = appleEvent.descriptorAtIndex_(i);
        try {
            value = appData.unpack(value);
        } catch (e) {}
        var code = event.keywordForDescriptorAtIndex_(i);
        switch (code) {
        case kae.keyDirectObject:
            directParam = value;
            break;
        case kae.keyAERequestedType: 
            params.push(`asType:${formatValue(value)}`);
            break;
        case kae.keyASUserRecordFields:
            // TO DO: format as $KEY:VALUE,...
        default:
            params.push(`${(paramsByCode[code] || aesupport.formatFourCharString(code))}:${formatValue(value)}`);
        }
    }
    var desc = appleEvent.attributeDescriptorForKeyword_(kae.keySubjectAttr);
    if (desc && desc.descriptorType() !== kae.typeNull) { // typeNull = root application object
        try {
            subject = appData.unpack(desc);
        } catch (e) {
            subject = desc;
        }
    }
    // unpack reply requested and timeout attributes (TO DO: these attributes are unreliable since their values are passed into AESendMessage() rather than packed directly into the AppleEvent; should work for intercepted AEs sent by AS component, which is what translation tool consumes, but need to check)
    desc = appleEvent.attributeDescriptorForKeyword_(kae.keyReplyRequestedAttr);
    // keyReplyRequestedAttr appears to be boolean value encoded as Int32 (1=wait or queue reply; 0=no reply)
    if (desc && desc.int32Value() === 0) { params.push("sendOptions:[k.noReply]"); } // AS doesn't support most options
    // timeout
    desc = appleEvent.attributeDescriptorForKeyword_(kae.keyTimeoutAttr);
    if (desc) {
        const timeoutInTicks = timeout.int32Value
        if (timeoutInTicks == kae.kNoTimeOut) { // 'kNoTimeOut = -2' but we use <=0 as 'no timeout'
            params.push("withTimeout:0");
        } else if (timeoutInTicks > 0) { // ignore 'kAEDefaultTimeout = -1'
            params.push(`withTimeout:${timeoutInTicks / 60.0}`);
        }
    }
    // considering/ignoring attributes
    /* TO DO: "ignoring:[...]"
        if let considersAndIgnoresDesc = event.attributeDescriptor(forKeyword: _enumConsidsAndIgnores) {
            var considersAndIgnores: UInt32 = 0
            (considersAndIgnoresDesc.data as NSData).getBytes(&considersAndIgnores, length: MemoryLayout<UInt32>.size)
            if considersAndIgnores != defaultConsidersIgnoresMask {
                for (option, _, considersFlag, ignoresFlag) in considerationsTable {
                    if option == .case {
                        if considersAndIgnores & ignoresFlag > 0 { self.considering.remove(option) }
                    } else {
                        if considersAndIgnores & considersFlag > 0 { self.considering.insert(option) }
                    }
                }
            }
        }
    */
    var result;
    if (subject !== undefined) {
        if (aeselectors.isSpecifier(subject)) {
            result = String(subject);
        } else {
            result = `${_formatAppRoot(appData)}.customRoot(${formatValue(subject)})`;
        }
    } else if (aeselectors.isSpecifier(directParam)) {
        result = String(directParam);
        directParam = undefined;
    }
    if (directParam !== undefined) { params.push(`_:${formatValue(directParam)}`); }
    const arg = (params ? `{${params.join(', ')}}` : "");
    if (commandDef) {
        result += `.${commandDef.name}(${arg})`;
    } else {
        result += `.sendAppleEvent(${aesupport.formatFourCharString(eventClass)}, ${aesupport.formatFourCharString(eventID)}, ${arg})`;
    }
    return result;
}


/****************************************************************************************/


module.exports = {
    formatSpecifierRecord,
    formatValue, 
    formatCommand,
};
