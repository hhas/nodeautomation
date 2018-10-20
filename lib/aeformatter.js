#!/usr/bin/env node

'use strict';

// aeformatter

const util = require('util');

const objc = require('./objc');

const aesupport = require('./aesupport');


/****************************************************************************************/


function _formatAppRoot(appData) {
    if (appData.targetType === null) { return 'app'; } // TO DO: also return "app" if nested
    const methodName = appData.targetType === 'named' ? '' : `.${appData.targetType}`;
    return `app${methodName}(${formatValue(appData.targetID, appData)})`;
}


function formatSpecifierRecord(appData, specifierRecord) { // TO DO: pass flag to indicate nesting
    // TO DO: trap all errors and return opaque object representation with error description comment
    if (specifierRecord === undefined) { return '<BUG (specifierRecord = undefined)>' } // DEBUG; TO DO: delete
    if (specifierRecord.form === aesupport.kSpecifierRoot) { // app root; format application using appData info
        switch (specifierRecord.cachedDesc('descriptorType')) {
        case objc.typeNull:
            return _formatAppRoot(appData);
        case objc.typeCurrentContainer:
            return 'con';
        case objc.typeObjectBeingExamined:
            return 'its';
        default:
            return `${_formatAppRoot(appData)}.customRoot(${formatValue(specifierRecord.seld)})`;
        }
    }
    // TO DO: review rest of this function, making sure it formats targeted and untargeted specifiers correctly
    // recursively format specifier record chain, calling formatValue() to format selector args, etc.
    var parent = formatSpecifierRecord(appData, specifierRecord.from);
    // targeted specifier
    const form = specifierRecord.form('enumCodeValue');
    const seld = specifierRecord.seld;
    switch (form) {
    case objc.formPropertyID: // specifier.NAME or specifier.property(CODE)
        // (note: untargeted property specifiers are always stored as formAbsolutePosition, never formPropertyID, so this case only ever applies on targeted specifiers)
        const propertyCode = seld('typeCodeValue');
        // TO DO: what if it's an ambiguous term that's used as both property and elements name, in which case it needs disambiguated
        return `${parent}.${(appData.propertyNameByCode(propertyCode)
                            || `.property(${aesupport.formatFourCharString(propertyCode)})`)}`;
    case objc.formUserPropertyID: // specifier.$NAME
        return `${parent}.$${pname}`;
    case objc.formRelativePosition: // specifier.before/after(SYMBOL)
        var methodName, typeName;
        switch (seld('enumCodeValue')) {
        case objc.kAEPrevious:
            methodName = 'previous';
            break;
        case objc.kAENext:
            methodName = 'next';
            break;
        default:
            throw new TypeError(`Bad relative position selector: ${seld}`);
        }
        if (typeof specifierRecord.want === 'function') { // NSAppleEventDescriptor (previous/next element's type)
            const code = specifierRecord.want('typeCodeValue');
            if (specifierRecord.from.want('typeCodeValue') === code) { // TO DO: confirm from.want can never be null
                typeName = ''; // omit selector arg if unneeded, e.g. `words[1].next()`, not `words[1].next(k.word)`
            } else {
                const name = appData.elementsNameByCode(code);
                typeName = (name ? `k.${name}` : `k.fromTypeCode(${aesupport.formatFourCharString(code)})`);
            }
        } else { // untargeted specifier; 'want' is keyword's name
            typeName = (specifierRecord.from.want === specifierRecord.want) ? '' : specifierRecord.want;
        }
        return `${parent}.${methodName}(${typeName})`;
    case objc.kAELessThan:
        return `${parent}.lessThan(${formatValue(seld)})`;
    case objc.kAELessThanEquals:
        return `${parent}.lessOrEqual(${formatValue(seld)})`;
    case objc.kAEEquals:
        const packNotEquals = require('./aeselectors').packNotEqualsTest;
        return `${parent}.${specifierRecord.pack === packNotEquals ? "notEqualTo" : "equalTo"}(${formatValue(seld)})`;
    case objc.kAEGreaterThan:
        return `${parent}.moreThan(${formatValue(seld)})`;
    case objc.kAEGreaterThanEquals:
        return `${parent}.moreOrEqual(${formatValue(seld)})`;
    case objc.kAEBeginsWith:
        return `${parent}.beginsWith(${formatValue(seld)})`;
    case objc.kAEEndsWith:
        return `${parent}.endsWith(${formatValue(seld)})`;
    case objc.kAEContains:
        const packIsIn = require('./aeselectors').packIsInTest;
        return `${parent}.${ specifierRecord.pack === packIsIn ? "isIn" : "contains"}(${formatValue(seld)})`;
    case objc.kAEAND:
        return `${parent}.and(${seld.map(function(item) { return formatValue(item) }).join(", ")})`;
    case objc.kAEOR:
        return `${parent}.or(${seld.map(function(item) { return formatValue(item) }).join(", ")})`;
    case objc.kAENOT:
        return `${parent}.not`;
    }
    // untargeted specifiers store the property/elements name as string in 'want' slot, and convert it to four-char code upon being packed into an Apple event, at which time the target app's AppData instance containing the necessary terminology tables is supplied via __nodeautomation_pack__()
    if (typeof specifierRecord.want === 'function') { // NSAppleEventDescriptor (element[s] type)
        const elementsCode = specifierRecord.want('typeCodeValue');
        var elementsName = appData.elementsNameByCode(elementsCode);
        parent += (elementsName ? `.${elementsName}` : `.elements(${aesupport.formatFourCharString(elementsCode)})`);
    } else {
        parent = `${parent}.${specifierRecord.want}`;
    }
    switch (form) {
    case objc.formAbsolutePosition: // specifier.at(IDX)/first/middle/last/any
        if (aesupport.isDescriptor(seld) && seld('descriptorType') === objc.typeAbsoluteOrdinal) {
            switch (seld('typeCodeValue')) {
            case objc.kAEFirst:
                return `${parent}.first`;
            case objc.kAEMiddle:
                return `${parent}.middle`;
            case objc.kAELast:
                return `${parent}.last`;
            case objc.kAEAny:
                return `${parent}.any`;
            case objc.kAEAll:
                return `${parent}`;
            default:
            throw new TypeError(`Bad absolute ordinal selector: ${seld}`);
            }
        } else {
            return `${parent}.at(${formatValue(seld)})`;
        } // TO DO: check this and other code that prints seld: is it unpacked or desc?
    case objc.formName: // specifier[NAME] or specifier.named(NAME)
        return `${parent}.named(${formatValue(seld)})`;
    case objc.formUniqueID: // specifier.ID(UID)
        return `${parent}.ID(${formatValue(seld)})`;
        
    case objc.formRange: // specifier.thru(FROM,TO)
        // TO DO: show start/stop in shorthand form if their want is same as parent.want and they're absolute numeric index or name string
        return `${parent}.thru(${formatValue(seld.start)}, ${formatValue(seld.stop)})`;
    case objc.formTest: // specifier.where(TEST)
        return `${parent}.where(${formatValue(seld)})`;
    }
    throw new TypeError(`Invalid specifier form: ${specifierRecord.form}`);
}


function formatValue(value) {
    if (value === null) {
        return 'null';
    } else if (value.__nodeautomation_pack__ !== undefined) { // Specifier/Keyword/File
        return value.toString();
    } else if (value instanceof Date) {
        return `new Date(${util.inspect(value)})`; // util.inspect() annoyingly doesn't return a JS literal string
    } else if (value instanceof Array) {
        return `[${value.map(formatValue).join(', ')}]`;
    } else if (typeof value === 'function') {
        console.log(`Warning: nodeautomation's formatValue() received a function/NodObjC wrapper: ${value}`); // DEBUG
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
    if (addressDesc('descriptorType') === objc.typeProcessSerialNumber) { // AppleScript is old school
        addressDesc = addressDesc('coerceToDescriptorType', objc.typeKernelProcessID);
    }
    if (!addressDesc || addressDesc('descriptorType') !== objc.typeKernelProcessID) { // local processes are generally targeted by PID
        throw new TypeError(
                `Unsupported address type: ${aesupport.formatFourCharString(addressDesc('descriptorType'))}`);
    }
    const b = Buffer(4); // pid_t
    addressDesc('data')('getBytes', b, 'length', 4);
    const pid = b.readInt32LE();
    const process = objc.NSRunningApplication('runningApplicationWithProcessIdentifier', pid);
    if (!process) { throw new Error(`Can't find application process (PID: ${pid}).`); }
    const applicationURL = process('bundleURL');
    if (!applicationURL) { throw new Error("Can't get path to application bundle (PID: \(pid))."); }
    return applicationURL('path').toString();
}


function formatAppleEvent(appleEvent) {
    if (!(aesupport.isDescriptor(appleEvent) && appleEvent('descriptorType') === objc.typeAppleEvent)) {
        throw new TypeError(`formatAppleEvent() expected Apple event descriptor but received: ${appleEvent}`);
    }
    const aeappdata = require("./aeappdata");
    const aeselectors = require('./aeselectors');
    const addressDesc = appleEvent('attributeDescriptorForKeyword', objc.keyAddressAttr);
    const applicationPath = applicationPathForAddressDescriptor(addressDesc);
    // TO DO: check if full applicationPath === LaunchServices path for app's file name; if true, pass name only here
    const appData = new aeappdata.AppData("named", applicationPath, {});
    const eventClass = appleEvent('attributeDescriptorForKeyword', objc.keyEventClassAttr)('typeCodeValue');
    const eventID = appleEvent('attributeDescriptorForKeyword', objc.keyEventIDAttr)('typeCodeValue');
    // TO DO: what about kAECoreSuite/kASSubroutineEvent? format keyASSubroutineName as $NAME
    const commandDef = appData.commandDefinitionByCode(eventClass, eventID);
    var paramsByCode = {};
    if (commandDef) { for (var k in commandDef.params) { paramsByCode[commandDef.params[k]] = k; } }
    var directParam = undefined, params = [], subject = undefined;
    for (var i = 1; i <= appleEvent('numberOfItems'); i++) {
        var value = appleEvent('descriptorAtIndex', i);
        try {
            value = appData.unpack(value);
        } catch (e) {}
        var code = event('keywordForDescriptorAtIndex', i);
        switch (code) {
        case objc.keyDirectObject:
            directParam = value;
            break;
        case objc.keyAERequestedType: 
            params.push(`asType:${formatValue(value)}`);
            break;
        case objc.keyASUserRecordFields:
            // TO DO: format as $KEY:VALUE,...
        default:
            params.push(`${(paramsByCode[code] || aesupport.formatFourCharString(code))}:${formatValue(value)}`);
        }
    }
    var desc = appleEvent('attributeDescriptorForKeyword', objc.keySubjectAttr);
    if (desc && desc('descriptorType') !== objc.typeNull) { // typeNull = root application object
        try {
            subject = appData.unpack(desc);
        } catch (e) {
            subject = desc;
        }
    }
    // unpack reply requested and timeout attributes (TO DO: these attributes are unreliable since their values are passed into AESendMessage() rather than packed directly into the AppleEvent; should work for intercepted AEs sent by AS component, which is what translation tool consumes, but need to check)
    desc = appleEvent('attributeDescriptorForKeyword', objc.keyReplyRequestedAttr);
    // keyReplyRequestedAttr appears to be boolean value encoded as Int32 (1=wait or queue reply; 0=no reply)
    if (desc && desc('int32Value') === 0) { params.push("sendOptions:[k.noReply]"); } // AS doesn't support most options
    // timeout
    desc = appleEvent('attributeDescriptorForKeyword', objc.keyTimeoutAttr);
    if (desc) {
        const timeoutInTicks = timeout.int32Value
        if (timeoutInTicks == objc.kNoTimeOut) { // 'kNoTimeOut = -2' but we use <=0 as 'no timeout'
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
            result = subject.toString();
        } else {
            result = `${_formatAppRoot(appData)}.customRoot(${formatValue(subject)})`;
        }
    } else if (aeselectors.isSpecifier(directParam)) {
        result = directParam.toString();
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
    formatSpecifierRecord:formatSpecifierRecord,
    formatValue:formatValue, 
    formatCommand:formatCommand,
};
