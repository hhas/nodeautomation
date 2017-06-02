#!/usr/bin/env node

'use strict';

// aeformatter

const util = require('util');

const objc = require('./objc');

const aesupport = require('./aesupport');


/****************************************************************************************/


function unpackLazySpecifier(appData, specifier) {
    if (typeof specifier === 'object' && specifier.__nodeautomation_unpackFunc__ !== undefined) {
        return specifier.__nodeautomation_unpackFunc__(appData);
    }
    return specifier;
}


function formatAppRoot(appData) {
    if (appData.targetType === null) { return 'app'; } // TO DO: also return "app" if nested
    const methodName = appData.targetType === 'named' ? '' : `.${appData.targetType}`;
    return `app${methodName}(${formatValue(appData.targetID, appData)})`;
}


function formatSpecifier(appData, specifierRecord) { // TO DO: pass flag to indicate nesting
    if (specifierRecord === undefined) { return '<BUG (specifierRecord = undefined)>' }
    specifierRecord = unpackLazySpecifier(appData, specifierRecord);
    if (specifierRecord.form === aesupport.kSpecifierRoot) { // app root; format application using appData info
        switch (specifierRecord.cachedDesc('descriptorType')) {
        case objc.typeNull:
            return formatAppRoot(appData);
        case objc.typeCurrentContainer:
            return 'con';
        case objc.typeObjectBeingExamined:
            return 'its';
        default:
            return `${formatAppRoot(appData)}.customRoot(${formatValue(specifierRecord.seld)})`;
        }
    }
    // TO DO: review rest of this function, making sure it formats targeted and untargeted specifiers correctly
    // recursively format record, calling formatValue to format args, etc
    var parent = formatSpecifier(appData, specifierRecord.from);
    const isTargeted = typeof specifierRecord.want !== 'string'; // untargeted specifiers store the property/elements name as-is, and convert it to four-char code upon being packed into an Apple event, at which time the target app's AppData instance containing the necessary terminology tables is supplied via __nodeautomation_pack__()
    if (!isTargeted) {
        parent = `${parent}.${specifierRecord.want}`; // TO DO: need to apply
    }
    // targeted specifier
    const form = specifierRecord.form('enumCodeValue');
    const seld = specifierRecord.seld;
    switch (form) {
    case objc.formPropertyID: // specifier.NAME or specifier.property(CODE)
        const propertyCode = seld('typeCodeValue');
        var pname = appData.propertyNameByCode(propertyCode);
        if (pname === undefined) { pname = `.property(${aesupport.formatFourCharCode(propertyCode)})`; }
        return `${parent}.${pname}`;
    case objc.formUserPropertyID: // specifier.$NAME
        return `${parent}.$${pname}`;
    case objc.formRelativePosition: // specifier.before/after(SYMBOL)
        var methodName, typeName;
        switch (seld('enumCodeValue')) {
        case objc.kAEPrevious:
            methodName = 'previous';
        case objc.kAENext:
            methodName = 'next';
        default:
            throw new TypeError(`Invalid relative position: ${seld}`);
        }
        const code = specifierRecord.want('typeCodeValue');
        if (code === specifierRecord.from.want('typeCodeValue')) {
            typeName = '';
        } else {
            const name = appData.elementsNameByCode(code);
            typeName = (name === undefined) ? `k[${aesupport.formatFourCharCode(code)}]` : `k.${name}`;
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
    if (isTargeted) {
        //console.log('', specifierRecord);
        const elementsCode = specifierRecord.want('typeCodeValue');
        var elementsName = appData.elementsNameByCode(elementsCode);
        parent += elementsName === undefined ? `.elements(${aesupport.formatFourCharCode(elementsCode)})`
                                             : `.${elementsName}`;
    }
    switch (form) {
    case objc.formAbsolutePosition: // specifier.at(IDX)/first/middle/last/any
        if (seld('descriptorType') === objc.typeAbsoluteOrdinal) { // TO DO: is seld always packed desc or has it been unpacked?
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
            return `${parent}.at(${formatValue(appData.unpack(seld))})`;
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

function formatValue(value) { // TO DO: not actually sure we need to pass appData, since untargeted specifiers are self-formatting (since they record 'keywords' on construction, and always unpack as targeted)
    switch (typeof value) {
    case 'object':
        if (value.__nodeautomation_pack__ !== null) { // Specifier/Keyword.toString() returns literal representation
            return value.toString();
        } else if (value instanceof Date) {
            return `(new Date(${util.inspect(value)}))`; // util.inspect() annoyingly doesn't return a JS literal string
        } else if (value instanceof Array) {
            return `[${value.map(formatValue).join(', ')}]`;
        } // TO DO: what other objects need special handling? (how do we represent AE records?)
        return util.inspect(value);
//    case 'string':
//        return `"${value.replace('\\', '\\\\').replace('"', '\"')}"`; // TO DO: also escape \t, \r, \n?
    
    case 'function':
        console.log(`NodeAutomation/aeformatter Warning: value looks like a function/NodObjC wrapper: ${value}`); // DEBUG
    }
    return util.inspect(value);
}


function inspectSpecifier(appData, specifierRecord, d='  ') { // TO DO: how best to implement? (for now just dump out basic objspec representation; this won't display insertion/query records correctly though)
    if (specifierRecord === null) { return ''; } // TO DO: this is probably a bug
    if (specifierRecord === undefined) { return '<BUG undefined>'; }
    specifierRecord = unpackLazySpecifier(appData, specifierRecord);
    return `\n${d}${inspectSpecifier(appData, specifierRecord.from,d+'  ')}\n` +
            `${d}want:${formatValue(specifierRecord.want)}, ` +
                `form:${formatValue(specifierRecord.form)}, ` +
                `seld:${formatValue(specifierRecord.seld)}`;
}


/****************************************************************************************/


module.exports = {
    formatSpecifier:formatSpecifier, 
    formatValue:formatValue, 
    inspectSpecifier:inspectSpecifier,
};
