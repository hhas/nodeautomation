#!/usr/bin/env node

'use strict';

// aeselectors

// note: if implementing async support (assuming it's possible/practical in Node, given it requires a Carbon/Cocoa main event loop), callback function to handle a command's result/error should be passed as additional argument to calls, e.g. `specifier.command({...},function(result,error){...})`

const util = require('util');

const objc = require('./objc');

const aesupport = require('./aesupport');
const aeformatter = require('./aeformatter');


/****************************************************************************************/
// functions invoked when a specifier object is called; attached to specifier record


function getDataCommand(appData, parentSpecifierRecord, parametersObject) { // OBJSPEC(…) = shorthand for OBJSPEC.get(…)
    const commandDef = {name:'get', eventClass:objc.kAECoreSuite, eventID:objc.kAEGetData, params:{}};
    return appData.sendAppleEvent(commandDef, parentSpecifierRecord, parametersObject);
}


function callSubroutine(appData, parentSpecifierRecord, parametersObject) { // OBJSPEC.USERPROPERTY(…) is converted to OBJSPEC.USERCOMMAND(…)
    parametersObject = Object.assign({_:[]}, parametersObject);
    const directParameter = parametersObject._;
    if (!Array.isArray(directParameter)) {
        throw new TypeError(`Bad direct parameter in "$${specifier.seld}(...)" subroutine call ` +
                `(expected an Array of zero or more positional parameters): ${aesupport.formatValue(directParameter)}`);
    }
    const name = parametersObject[objc.keyASSubroutineName] = parentSpecifierRecord.seld;
    const commandDef = {name:name, eventClass:objc.kAECoreSuite, eventID:objc.kASSubroutineEvent, params:{}};
    return appData.sendAppleEvent(commandDef, parentSpecifierRecord.from, parametersObject);
}


function doNotCall(appData, parentSpecifierRecord, parametersObject) { // OBJSPEC is non-callable
    throw new TypeError(`Object is not callable: ${aeformatter.formatSpecifierRecord(appData, parentSpecifierRecord)}`);
}


// support function used when converting all-elements specifier to a one-element/many-elements specifier;
// e.g. app.documents -> app.documents.first, app.documents.named("README"), app.documents.thru(1, 3), etc.
// (this avoids need for an explicit 'every' selector, e.g. app.documents.all, which would be clumsy and error-prone)

function discardAllElementsSpecifierRecord(specifierRecord) {
    return specifierRecord.seld === aesupport.kAEAllDesc ? specifierRecord.from : specifierRecord;
}


function isSpecifier(value) {
    return typeof value === 'object' && value.__nodeautomation_appData__ !== undefined;
}


/****************************************************************************************/
// Pack specifier records into AEDescs

function packSpecifier(appData, specifierRecord) { // packs specifierRecord field into AEDesc; this is just a convenience function to make the specifier record ADT easier to use
    return specifierRecord.pack(appData, specifierRecord);
}

function packObjectSpecifier(appData, specifierRecord) {
    if (specifierRecord.cachedDesc) { return specifierRecord.cachedDesc; }
    const desc = objc.NSAppleEventDescriptor('recordDescriptor')('coerceToDescriptorType', objc.typeObjectSpecifier);
    desc('setDescriptor', packSpecifier(appData, specifierRecord.from), 'forKeyword', objc.keyAEContainer);
    desc('setDescriptor', appData.pack(specifierRecord.want), 'forKeyword', objc.keyAEDesiredClass);
    desc('setDescriptor', specifierRecord.form, 'forKeyword', objc.keyAEKeyForm);
    desc('setDescriptor', appData.pack(specifierRecord.seld), 'forKeyword', objc.keyAEKeyData);
    specifierRecord.cachedDesc = desc;
    return desc;
}

function packInsertionSpecifier(appData, specifierRecord) {
    if (specifierRecord.cachedDesc) { return specifierRecord.cachedDesc; }
    const desc = objc.NSAppleEventDescriptor('recordDescriptor')('coerceToDescriptorType', objc.typeInsertionLoc);
    desc('setDescriptor', packSpecifier(appData, specifierRecord.from), 'forKeyword', objc.keyAEObject);
    desc('setDescriptor', appData.pack(specifierRecord.seld), 'forKeyword', objc.keyAEPosition);
    specifierRecord.cachedDesc = desc;
    return desc;
}


// pack start/stop argument in by-range specifier

function packRangeStartStop(appData, value, wantDesc) {
    if (isSpecifier(value)) { // note: this doesn't exclude its-based specifiers but it's unlikely user would pass one here by accident so not too worried; receiving apps should return error on receiving obviously invalid params
        return value.__nodeautomation_pack__(appData);
    }
    var form, seld;
    switch (typeof value) { // treat integer/string as shortcut for by-index/by-name specifier relative to container
    case 'number':
        form = aesupport.formAbsolutePositionDesc;
        seld = objc.NSAppleEventDescriptor('descriptorWithInt32', aesupport.SInt32(value));
        break;
    case 'string':
        form = aesupport.formNameDesc;
        seld = objc.NSAppleEventDescriptor('descriptorWithString', objc(value));
        break;
    default: // bad start/stop argument type for SPECIFIER.thru() selector
        throw new TypeError(`Bad range selector: ${aeformatter.formatValue(value)}`);
    } // fall-thru to pack the index/name value as con-based objspec descriptor
    const desc = objc.NSAppleEventDescriptor('recordDescriptor')('coerceToDescriptorType', objc.typeObjectSpecifier);
    desc('setDescriptor', aesupport.kConRootDesc, 'forKeyword', objc.keyAEContainer);
    desc('setDescriptor', wantDesc, 'forKeyword', objc.keyAEDesiredClass);
    desc('setDescriptor', form, 'forKeyword', objc.keyAEKeyForm);
    desc('setDescriptor', seld, 'forKeyword', objc.keyAEKeyData);
    return desc;
}


// pack test clause

function packComparisonSpecifier(appData, specifierRecord) {
    if (specifierRecord.cachedDesc) { return specifierRecord.cachedDesc; }
    const desc = objc.NSAppleEventDescriptor('recordDescriptor')('coerceToDescriptorType', objc.typeCompDescriptor);
    desc('setDescriptor', specifierRecord.form, 'forKeyword', objc.keyAECompOperator);
    desc('setDescriptor', packSpecifier(appData, specifierRecord.from), 'forKeyword', objc.keyAEObject1);
    desc('setDescriptor', appData.pack(specifierRecord.seld), 'forKeyword', objc.keyAEObject2);
    specifierRecord.cachedDesc = desc;
    return desc;
}

function packNotEqualsTest(appData, specifierRecord) { // pack as equals, then add NOT
    if (specifierRecord.cachedDesc) { return specifierRecord.cachedDesc; }
    var desc = packNOTTest(packComparisonSpecifier(appData, specifierRecord));
    specifierRecord.cachedDesc = desc;
    return desc;
}

function packIsInTest(appData, specifierRecord) { // pack as `contains` with operands reversed
    if (specifierRecord.cachedDesc) { return specifierRecord.cachedDesc; }
    const desc = objc.NSAppleEventDescriptor('recordDescriptor')('coerceToDescriptorType', objc.typeCompDescriptor);
    desc('setDescriptor', specifierRecord.form, 'forKeyword', objc.keyAECompOperator);
    desc('setDescriptor', appData.pack(specifierRecord.seld), 'forKeyword', objc.keyAEObject1);
    desc('setDescriptor', packSpecifier(appData, specifierRecord.from), 'forKeyword', objc.keyAEObject2);
    specifierRecord.cachedDesc = desc;
    return desc;
}

function packLogicalTest(appData, specifierRecord) {
    if (specifierRecord.cachedDesc) { return specifierRecord.cachedDesc; }
    const listDesc = objc.NSAppleEventDescriptor('listDescriptor');
    listDesc('insertDescriptor', packSpecifier(appData, specifierRecord.from), 'atIndex', 0);
    for (var item of specifierRecord.seld) {
        try {
            const itemDesc = item.__nodeautomation_pack__(appData); // (fails if an arg is obviously wrong type)
            const descType = itemDesc('descriptorType'); // (though we'll still explicitly check to be sure)
            if (descType != objc.typeCompDescriptor && descType != objc.typeLogicalDescriptor) {
                throw new TypeError(`Wrong descriptor type: ${aesupport.formatFourCharString(descType)}`);
            }
            listDesc('insertDescriptor', itemDesc, 'atIndex', 0);
        } catch (e) {
            throw new ParameterError(item, e.toString());
        }
    }
    const desc = objc.NSAppleEventDescriptor('recordDescriptor')('coerceToDescriptorType', objc.typeLogicalDescriptor);
    desc('setDescriptor', specifierRecord.form, 'forKeyword', objc.keyAELogicalOperator);
    desc('setDescriptor', listDesc, 'forKeyword', objc.keyAELogicalTerms);
    specifierRecord.cachedDesc = desc;
    return desc;
}

function packNOTTest(parentTestDesc) {
    const listDesc = objc.NSAppleEventDescriptor('listDescriptor');
    listDesc('insertDescriptor', parentTestDesc, 'atIndex', 0);
    const desc = objc.NSAppleEventDescriptor('recordDescriptor')('coerceToDescriptorType', objc.typeLogicalDescriptor);
    desc('setDescriptor', aesupport.kAENOTDesc, 'forKeyword', objc.keyAELogicalOperator);
    desc('setDescriptor', listDesc, 'forKeyword', objc.keyAELogicalTerms);
    return desc;
}


// pack an untargeted app/con/its-based specifier; the targeted AppData is supplied by the targeted specifier in which it is used, and provides terminology tables needed to convert its unresolved names (stored in records' 'want' slot) to four-char codes so that it can be packed into records

function packUntargetedObjectSpecifier(targetedAppData, specifierRecord) { // targeted appData provides terminology tables
    if (specifierRecord.cachedDesc) { return specifierRecord.cachedDesc; }
    var want, form, seld;
    const name = specifierRecord.want;
    const codeDesc = targetedAppData.propertyDescriptorByName(name);
    if (codeDesc) { // is it a property name?, if it is, return `PROPERTY of PARENTSPECIFIER`
        if (specifierRecord.seld !== aesupport.kAEAllDesc) {
            throw new TypeError(`Can't call selector methods on "${name}" property.`);
        }
        want = aesupport.typePropertyDesc;
        form = aesupport.formPropertyDesc;
        seld = codeDesc;
    } else { // otherwise see if it's an elements name
        const codeDesc = targetedAppData.elementsDescriptorByName(name);
        if (!codeDesc) { throw new Error(`Unknown property/elements name: "${name}"`); }
        want = codeDesc;
        form = specifierRecord.form;
        seld = specifierRecord.seld;
    }
    const desc = objc.NSAppleEventDescriptor('recordDescriptor')('coerceToDescriptorType', 
                                                                 objc.typeObjectSpecifier);
    desc('setDescriptor', packSpecifier(targetedAppData, specifierRecord.from), 'forKeyword', objc.keyAEContainer);
    desc('setDescriptor', targetedAppData.pack(want), 'forKeyword', objc.keyAEDesiredClass);
    desc('setDescriptor', form, 'forKeyword', objc.keyAEKeyForm);
    desc('setDescriptor', targetedAppData.pack(seld), 'forKeyword', objc.keyAEKeyData);
    specifierRecord.cachedDesc = desc;
    return desc;
}


/****************************************************************************************/
// constructors for selector tables' attributes/methods (first/middle/last, at/named/where, etc)


function newInsertionAttribute(selectorDataDesc) {
    return function(appData, parentSpecifierRecord) {
        return newSpecifier(appData, {
                from:parentSpecifierRecord,
                seld:selectorDataDesc,
                cachedDesc:null, 
                selectors:appData.insertionSpecifierAttributes,
                call:doNotCall,
                pack:packInsertionSpecifier});
    };
}

function newRelativeSelectorMethod(selectorDataDesc) {
    return function(appData, parentSpecifierRecord) {
        return function(elementType = null) {
            if (elementType === null) {
                elementType = parentSpecifierRecord.want;
            } else if (!aesupport.isKeyword(elementType)) {
                throw new TypeError(
                    `Bad previous/next argument (not a keyword): ${aeformatter.formatValue(elementType)}`);
            }
            return newSpecifier(appData, {
                    from:parentSpecifierRecord, // note: do not discard all-elements as, unlike others, this selector always applies to the parent specifier (AS sloppily allows `ELEMENT before/after every ELEMENT` queries to be constructed, even though apps should always reject them as logically nonsensical)
                    want:elementType,
                    form:aesupport.formRelativePositionDesc, 
                    seld:selectorDataDesc,
                    cachedDesc:null, 
                    selectors:appData.singleElementSpecifierAttributes,
                    call:getDataCommand,
                    pack:packObjectSpecifier});
        };
    };
}

function newManyToOneSelectorAttribute(formDesc, selectorDataDesc) {
    return function(appData, parentSpecifierRecord) {
        return newSpecifier(appData, {
                from:discardAllElementsSpecifierRecord(parentSpecifierRecord),
                want:parentSpecifierRecord.want, 
                form:formDesc, 
                seld:selectorDataDesc,
                cachedDesc:null, 
                selectors:appData.singleElementSpecifierAttributes,
                call:getDataCommand,
                pack:packObjectSpecifier});
    };
}

function newManyToOneSelectorMethod(formDesc) {
    return function(appData, parentSpecifierRecord) {
        return function(selectorData) {
            return newSpecifier(appData, {
                    from:discardAllElementsSpecifierRecord(parentSpecifierRecord),
                    want:parentSpecifierRecord.want, 
                    form:formDesc, 
                    seld:selectorData,
                    cachedDesc:null, 
                    selectors:appData.singleElementSpecifierAttributes,
                    call:getDataCommand,
                    pack:packObjectSpecifier});
        };
    };
}

function newRangeSpecifier(appData, parentSpecifierRecord, start, stop) {
    return newSpecifier(appData, { 
        from:discardAllElementsSpecifierRecord(parentSpecifierRecord),
        want:parentSpecifierRecord.want,
        form:aesupport.formRangeDesc, 
        seld:new Range(start, stop, parentSpecifierRecord.want),
        cachedDesc:null, 
        selectors:appData.multipleElementsSpecifierAttributes,
        call:getDataCommand,
        pack:packObjectSpecifier});
}


function Range(start, stop, defaultWant) { // {start:OBJSPEC,stop:OBJSPEC} constructor; used in by-range specifiers
    this.start = start;
    this.stop = stop;
    this.__nodeautomation_pack__ = function(appData) {
        const desc = objc.NSAppleEventDescriptor('recordDescriptor')('coerceToDescriptorType',
                                                                     objc.typeRangeDescriptor);
        desc('setDescriptor', packRangeStartStop(appData, start, defaultWant), 'forKeyword', objc.keyAERangeStart);
        desc('setDescriptor', packRangeStartStop(appData, stop, defaultWant), 'forKeyword', objc.keyAERangeStop);
        return desc;
    };
    this.toString = function() { return `${start},${stop}`; };
}


// test clauses

function newTestSpecifierMethod(operatorDesc, packMethod = packComparisonSpecifier) { // lessThan, equalTo, isIn, etc
    return function(appData, parentSpecifierRecord) {
        return function(rightOperand) {
            return newSpecifier(appData, {
                    from:parentSpecifierRecord, // left operand
                    form:operatorDesc, // operator
                    seld:rightOperand, // right operand
                    cachedDesc:null, 
                    selectors:logicalTestConstructors,
                    call:doNotCall,
                    pack:packMethod});
        };
    };
}

function newLogicalTestSpecifierMethod(operatorDesc) { // and, or
    return function(appData, parentSpecifierRecord) {
        return function(...rightOperands) {
            if (rightOperands.length < 1) { throw new TypeError("'and'/'or' methods require one or more arguments."); }
            return newSpecifier(appData, {
                    from:parentSpecifierRecord, // left operand
                    form:operatorDesc, // operator
                    seld:rightOperands, // right operand
                    cachedDesc:null, 
                    selectors:logicalTestConstructors,
                    call:doNotCall,
                    pack:packLogicalTest});
        };
    };
}


/****************************************************************************************/
// selector sub-tables; these implement all the behaviors for specifier Proxy objects

//    CLASS                 DESCRIPTION                         CAN CONSTRUCT
//
//    Query                 [base class]
//     ├─PREFIXInsertion    insertion location specifier        ├─commands
//     └─PREFIXObject       [object specifier base protocol]    └─commands, and property and all-elements specifiers
//        ├─PREFIXItem         single-object specifier             ├─previous/next selectors
//        │  └─PREFIXItems     multi-object specifier              │  └─by-index/name/id/ordinal/range/test selectors
//        └─PREFIXRoot         App/Con/Its (untargeted roots)      ├─[1]
//           └─APPLICATION     Application (app-targeted root)     └─initializers


const targetedCommandConstructors = { // allow commands to be called on targeted app-based specifiers
    "__nodeautomation_command__": function(appData, parentSpecifierRecord, name) {
        const commandDef = appData.commandDefinitionByName(name);
        if (!commandDef) { return null; } // not found
        return function(parametersObject = {}) {
            return appData.sendAppleEvent(commandDef, parentSpecifierRecord, parametersObject);
        };
    }
};


const _specifierConstructors = { // appear on all app, con, its specifiers
    "__nodeautomation_userProperty__": function(appData, parentSpecifierRecord, name) {
        // if name starts with $, e.g. SPECIFIER.$foo, it's an identifier-based property/subroutine name (we won't know which till it's called though, so return a proxy that acts as a property specifier unless it's called, in which case it changes to a subroutine call)
        if (typeof name == 'string' && name.startsWith('$')) {
            // return proxy object that allows constructing either a sub-specifier or calling as subroutine
            return newSpecifier(appData, {
                    from:parentSpecifierRecord,
                    want:aesupport.typePropertyDesc,
                    form:aesupport.formUserPropertyDesc,
                    seld:name.slice(1), // name minus the '$' prefix
                    cachedDesc:null,
                    selectors:appData.propertySpecifierAttributes,
                    call:callSubroutine, // e.g. SPECIFIER.$foo(…) sends a subroutine event 'foo' as subroutine name and SPECIFIER as subject attribute
                    pack:packObjectSpecifier});
        }
        return null; // not a user property/subroutine name
    },
    "property": function(appData, parentSpecifierRecord) { // specify a property by four-char code
        return function(fourCharCode) {
            return newSpecifier(appData, {
                    from:parentSpecifierRecord, 
                    want:aesupport.typePropertyDesc, 
                    form:aesupport.formPropertyDesc, 
                    seld:aesupport.newTypeDescriptor(aesupport.parseFourCharCode(fourCharCode)),
                    cachedDesc:null, 
                    selectors:appData.propertySpecifierAttributes,
                    call:getDataCommand,
                    pack:packObjectSpecifier});
        };
    },
    "elements": function(appData, parentSpecifierRecord) { // specify [all] elements by four-char code
        return function(fourCharCode) {
            return newSpecifier(appData, {
                    from:parentSpecifierRecord, 
                    want:aesupport.newTypeDescriptor(aesupport.parseFourCharCode(fourCharCode)),
                    form:aesupport.formAbsolutePositionDesc, 
                    seld:aesupport.kAEAllDesc,
                    cachedDesc:null, 
                    selectors:appData.multipleElementsSpecifierAttributes,
                    call:getDataCommand,
                    pack:packObjectSpecifier});
        };
    },
};


// root/property/element[s]

const targetedSpecifierConstructors = Object.assign({
    "__nodeautomation_property__": function(appData, parentSpecifierRecord, name) {
        const codeDesc = appData.propertyDescriptorByName(name);
        if (codeDesc) { // is it a property name?, if it is, return `PROPERTY of PARENTSPECIFIER`
            return newSpecifier(appData, {
                                from:parentSpecifierRecord,
                                want:aesupport.typePropertyDesc,  
                                form:aesupport.formPropertyDesc, 
                                seld:codeDesc,
                                cachedDesc:null, 
                                selectors:appData.propertySpecifierAttributes,
                                call:getDataCommand,
                                pack:packObjectSpecifier});
        };
        return null; // not found
    },
    "__nodeautomation_elements__": function(appData, parentSpecifierRecord, name) {
        const codeDesc = appData.elementsDescriptorByName(name);
        if (codeDesc) { // is it an elements name? if it is, return `every TYPECLASS of PARENTSPECIFIER`
            return newSpecifier(appData, {
                                from:parentSpecifierRecord, 
                                want:codeDesc,
                                form:aesupport.formAbsolutePositionDesc, 
                                seld:aesupport.kAEAllDesc,
                                cachedDesc:null, 
                                selectors:appData.multipleElementsSpecifierAttributes,
                                call:getDataCommand,
                                pack:packObjectSpecifier});
        };
        return null; // not found
    }
}, _specifierConstructors, targetedCommandConstructors);


const targetedRootSpecifierConstructors = Object.assign({
    "sendAppleEvent": function(appData, parentSpecifierRecord) {
        return function(eventClass, eventID, parametersObject = {}) {
            const commandDef = {eventClass:aesupport.parseFourCharCode(eventClass), 
                                eventID:aesupport.parseFourCharCode(eventID), params:{}};
            return appData.sendAppleEvent(commandDef, parentSpecifierRecord, parametersObject);
        };
    },
    "isRunning": function(appData, parentSpecifierRecord) {
        return appData.isRunning();
    },
    "launch": function(appData, parentSpecifierRecord) {
         return function() { appData.launch(); }; // appData.launch implements special-case behavior
    },
}, targetedSpecifierConstructors);


const untargetedSpecifierConstructors = Object.assign({
    "__nodeautomation_unknownName__": function(appData, parentSpecifierRecord, name) {
        // we can't know if an attribute is property or all-elements name until terminology is available, so for now construct as if it's all-elements specifier as that has full set of selectors
        return newSpecifier(appData, {
                    from:parentSpecifierRecord,
                    want:name,
                    form:aesupport.formAbsolutePositionDesc,
                    seld:aesupport.kAEAllDesc,
                    untargetedAppData:appData,
                    cachedDesc:null, 
                    selectors:appData.multipleElementsSpecifierAttributes,
                    call:doNotCall,
                    pack:packUntargetedObjectSpecifier});
    },
}, _specifierConstructors);


// element[s]


const singleElementSelectors = {
    // insert at beginning/end of all elements (included here because AS is really loose about these)
    // following should return new specifier Proxy which provides commands only (insertions)
    "beginning": newInsertionAttribute(aesupport.kAEBeginningDesc),
    "end": newInsertionAttribute(aesupport.kAEEndDesc),
    "before": newInsertionAttribute(aesupport.kAEBeforeDesc),
    "after": newInsertionAttribute(aesupport.kAEAfterDesc),
    // relative position; these return a function that takes optional argument[s] that provide prop
    "previous": newRelativeSelectorMethod(aesupport.kAEPreviousDesc),
    "next": newRelativeSelectorMethod(aesupport.kAENextDesc),
};


const multipleElementSelectors = Object.assign({ // these are available on all-elements specifiers, and on multi-element specifiers returned by thru/slice (by-range) and where (by-test)
    // select single element
    // following should return new specifier Proxy
    "first": newManyToOneSelectorAttribute(aesupport.formAbsolutePositionDesc, aesupport.kAEFirstDesc),
    "middle": newManyToOneSelectorAttribute(aesupport.formAbsolutePositionDesc, aesupport.kAEMiddleDesc),
    "last": newManyToOneSelectorAttribute(aesupport.formAbsolutePositionDesc, aesupport.kAELastDesc),
    "any": newManyToOneSelectorAttribute(aesupport.formAbsolutePositionDesc, aesupport.kAEAnyDesc),
    // following should return function that takes the argument[s] that provide seld
    "at": newManyToOneSelectorMethod(aesupport.formAbsolutePositionDesc),
    "__nodeautomation_zeroIndexSelector__": function(appData, parentSpecifierRecord, name) {
        if (name.match(/^-?[0-9]+$/)) { // use ELEMENTS[INT] for zero-indexed `at()` shortcut
            return newSpecifier(appData, {
                    from:discardAllElementsSpecifierRecord(parentSpecifierRecord),
                    want:parentSpecifierRecord.want,
                    form:aesupport.formAbsolutePositionDesc, 
                    seld:aesupport.convertZeroToOneIndex(name),
                    cachedDesc:null, 
                    selectors:appData.singleElementSpecifierAttributes,
                    call:getDataCommand,
                    pack:packObjectSpecifier});
        } else {
            return null;
        }
    }, // always called; if present, checks if selector is digit[s] and returns by-index specifier if it is; else returns null and matching continues; not sure if this should be here or baked into main code (prob latter, along with keyword/string)
    "named": newManyToOneSelectorMethod(aesupport.formNameDesc),
    "ID": newManyToOneSelectorMethod(aesupport.formUniqueIDDesc),
    // select multiple elements
    "thru": function(appData, parentSpecifierRecord) {
        return function(start, stop = -1) {
            return newRangeSpecifier(appData, parentSpecifierRecord, start, stop);
        };
    },
    "slice": function(appData, parentSpecifierRecord) {
        return function(fromIndex, toIndex = -1) { // ELEMENTS.slice(INT,INT) = zero-indexed shortcut for `thru()`
            return newRangeSpecifier(appData, parentSpecifierRecord,
                                     aesupport.convertZeroToOneIndex(fromIndex), 
                                     aesupport.convertZeroToOneIndex(toIndex));
        };
    },
    "where": function(appData, parentSpecifierRecord) { // aka 'whose'
        return function(testClause) {
            const testAppData = testClause.__nodeautomation_appData__; // confirm testClause is its-based specifier
            if (testAppData === undefined || testAppData.rootSpecifierDescriptor !== aesupport.kItsRootDesc) {
                const parent = aeformatter.formatSpecifierRecord(appData, parentSpecifierRecord);
                const arg = aeformatter.formatValue(testClause);
                throw new TypeError(`Bad 'where' argument (not an its-based specifier) ${parent}.where(${arg})`);
            }
            return newSpecifier(appData, {
                    from:discardAllElementsSpecifierRecord(parentSpecifierRecord),
                    want:parentSpecifierRecord.want,
                    form:aesupport.formTestDesc, 
                    seld:testClause,
                    cachedDesc:null, 
                    selectors:appData.singleElementSpecifierAttributes,
                    call:getDataCommand,
                    pack:packObjectSpecifier});

        }
    },
}, singleElementSelectors);



// its-based specifiers

const comparisonTestConstructors = { // available on its-based specifiers; all return a closure that takes second operand
    "lessThan": newTestSpecifierMethod(aesupport.kAELessThanDesc),
    "lessOrEqual": newTestSpecifierMethod(aesupport.kAELessThanEqualsDesc),
    "equalTo": newTestSpecifierMethod(aesupport.kAEEqualsDesc),
    "notEqualTo": newTestSpecifierMethod(aesupport.kAEEqualsDesc, packNotEqualsTest), // pack as !(op1==op2)
    "moreThan": newTestSpecifierMethod(aesupport.kAEGreaterThanDesc),
    "moreOrEqual": newTestSpecifierMethod(aesupport.kAEGreaterThanEqualsDesc),
    "beginsWith": newTestSpecifierMethod(aesupport.kAEBeginsWithDesc),
    "endsWith":   newTestSpecifierMethod(aesupport.kAEEndsWithDesc),
    "contains":   newTestSpecifierMethod(aesupport.kAEContainsDesc),
    "isIn":       newTestSpecifierMethod(aesupport.kAEContainsDesc, packIsInTest), // pack as op2.contains(op1)
};


const logicalTestConstructors = { // available on comparison and logical tests
    "and": newLogicalTestSpecifierMethod(aesupport.kAEANDDesc),
    "or":  newLogicalTestSpecifierMethod(aesupport.kAEORDesc),
    "not": function(appData, parentSpecifierRecord) {
                return function(selectorData) {
                    return newSpecifier(appData, {
                            from:parentSpecifierRecord, // unary operand
                            cachedDesc:null, 
                            selectors:logicalTestConstructors,
                            call:doNotCall,
                            pack:function(appData, specifierRecord) {
                                if (specifierRecord.cachedDesc) { return specifierRecord.cachedDesc; }
                                var desc = packNOTTest(packSpecifier(appData, specifierRecord.from));
                                specifierRecord.cachedDesc = desc;
                                return desc;
                            }});
                }
    },
};


/****************************************************************************************/
// lookup tables used by specifier Proxy objects; these add selector attributes/methods (first, at, where, etc)

const targetedAppRootTables = {
    rootSpecifierDescriptor: aesupport.kAppRootDesc,
    rootSpecifierAttributes: targetedRootSpecifierConstructors, // app(...); also provides lower-level sendAppleEvent()
    insertionSpecifierAttributes: targetedCommandConstructors,
    propertySpecifierAttributes: targetedSpecifierConstructors,
    singleElementSpecifierAttributes: Object.assign({}, targetedSpecifierConstructors, singleElementSelectors),
    multipleElementsSpecifierAttributes: Object.assign({}, targetedSpecifierConstructors, multipleElementSelectors),
};

const untargetedAppRootTables = {
    rootSpecifierDescriptor: aesupport.kAppRootDesc,
    rootSpecifierAttributes: untargetedSpecifierConstructors, // app
    insertionSpecifierAttributes: {},
    propertySpecifierAttributes: untargetedSpecifierConstructors,
    singleElementSpecifierAttributes: Object.assign({}, untargetedSpecifierConstructors, singleElementSelectors),
    multipleElementsSpecifierAttributes: Object.assign({}, untargetedSpecifierConstructors, multipleElementSelectors),
};

const untargetedConRootTables = {
    rootSpecifierDescriptor: aesupport.kConRootDesc,
    rootSpecifierAttributes: untargetedSpecifierConstructors, // con
    insertionSpecifierAttributes: {},
    propertySpecifierAttributes: untargetedSpecifierConstructors,
    singleElementSpecifierAttributes: Object.assign({}, untargetedSpecifierConstructors, singleElementSelectors),
    multipleElementsSpecifierAttributes: Object.assign({}, untargetedSpecifierConstructors, multipleElementSelectors),
};

const untargetedItsRootTables = {
    rootSpecifierDescriptor: aesupport.kItsRootDesc,
    rootSpecifierAttributes: Object.assign({}, untargetedSpecifierConstructors, comparisonTestConstructors), // its
    insertionSpecifierAttributes: comparisonTestConstructors,
    propertySpecifierAttributes: Object.assign({}, untargetedSpecifierConstructors, comparisonTestConstructors),
    singleElementSpecifierAttributes: Object.assign({}, 
                            untargetedSpecifierConstructors, singleElementSelectors, comparisonTestConstructors),
    multipleElementsSpecifierAttributes: Object.assign({}, 
                            untargetedSpecifierConstructors, multipleElementSelectors, comparisonTestConstructors), 
};


/****************************************************************************************/
// wraps specifier record in a proxy object


function newSpecifier(appData, specifierRecord) { // property/all-elements
    // specifier records are ADTs
    return new Proxy(function() {}, { 
        apply: function(target, thisArg, argumentsList) { // this may be a convenience shortcut for SPECIFIER.get(...argumentsList), where permitted, or a SPECIFIER.$NAME(...argumentsList) subroutine call
            var parametersObject;
            switch (argumentsList.length) {
            case 0:
                parametersObject = {};
                break;
            case 1:
                parametersObject = argumentsList[0];
                if (typeof parametersObject !== 'object') {
                    throw new TypeError(
                            `Command requires a 'parameters' object but received ${typeof parametersObject}.`);
                }
                break;
            default:
                throw new TypeError(
                        `Command requires a single argument ('parameters' object), if any, but received ${argumentsList.length}.`);
            }
            return specifierRecord.call(appData, specifierRecord, parametersObject);
        },
        get: function(target, name) { // name may be JS slot name, app property/elements/command, 0-index (if integer)
            // is it display/instrospection?
            switch (name) {
            case Symbol.toPrimitive:
            case util.inspect.custom: 
            case "toString":
                return function() { return aeformatter.formatSpecifierRecord(appData, specifierRecord); };
            case Symbol.toStringTag:
            case "valueOf":
            case "constructor":
                return undefined;
            case "__nodeautomation_pack__":
                return function(appData) { // note: AppData instance that passes itself here is already targeted
                    return specifierRecord.pack(appData, specifierRecord);
                };
            case "__nodeautomation_appData__":
                return appData;
            case "__nodeautomation_specifierRecord__":
                return specifierRecord;
            case "customRoot":
                return function(rootValue) {
                    return newSpecifier(appData, newCustomRootSpecifierRecord(rootValue));
                };
            }
            if (typeof name !== 'string') { return undefined; }
            // is it a selector?
            const selectorFunc = specifierRecord.selectors[name];
            if (selectorFunc) { // is it a standard selector ()
                return selectorFunc(appData, specifierRecord, name);
            }
            for (var specialFunc of [specifierRecord.selectors.__nodeautomation_property__,
                                     specifierRecord.selectors.__nodeautomation_elements__,
                                     specifierRecord.selectors.__nodeautomation_command__,
                                     specifierRecord.selectors.__nodeautomation_zeroIndexSelector__,
                                     specifierRecord.selectors.__nodeautomation_userProperty__,
                                     specifierRecord.selectors.__nodeautomation_unknownName__]) { // important: __unknownName__ must be tested for last as it's the catchall for untargeted specifiers' names
                if (specialFunc) {
                    const childSpecifier = specialFunc(appData, specifierRecord, name);
                    if (childSpecifier) { return childSpecifier; }
                }
            }
            throw new TypeError(`Unknown property/elements/command name: ${aeformatter.formatValue(name)}`);
        }
    });
}


function packCachedDesc(appData, specifierRecord) { return specifierRecord.cachedDesc; }


function newCustomRootSpecifierRecord(rootValue) {
    return {from:null,
            want:null,
            form:aesupport.kSpecifierRoot, // end of specifier chain; cachedDesc = app/con/its root
            seld:rootValue,
            cachedDesc:null,
            selectors:targetedAppRootTables.rootSpecifierAttributes,
            call:doNotCall,
            pack:function(appData, specifierRecord) { return appData.pack(specifierRecord.seld); }};
}


function newRootSpecifierRecord(appData) {
    return {from:null,
            want:null,
            form:aesupport.kSpecifierRoot, // end of specifier chain; cachedDesc = app/con/its root
            seld:null,
            cachedDesc:appData.rootSpecifierDescriptor,
            selectors:appData.rootSpecifierAttributes,
            call:doNotCall,
            pack:packCachedDesc};
}


function newRootSpecifier(appData) {
    return newSpecifier(appData, newRootSpecifierRecord(appData));
}



/****************************************************************************************/


module.exports = {
    targetedAppRootTables:targetedAppRootTables, // can construct app(…)-based specifiers and also call commands on them
    untargetedAppRootTables:untargetedAppRootTables, // can construct app-based specifiers
    untargetedConRootTables:untargetedConRootTables, // can construct con-based specifiers
    untargetedItsRootTables:untargetedItsRootTables, // can construct its-based specifiers, containment/comparison tests
    doNotCall:doNotCall, 
    getDataCommand:getDataCommand,
    newSpecifier:newSpecifier,
    packSpecifier:packSpecifier,
    isSpecifier:isSpecifier,
    
    Range:Range, // used in unpack
    newRootSpecifier:newRootSpecifier,
    newRootSpecifierRecord:newRootSpecifierRecord,
    newCustomRootSpecifierRecord:newCustomRootSpecifierRecord,
    
    packCachedDesc:packCachedDesc, // also used in AppData to minimize unpack+repack
    
    // formatter needs the following to compensate for lack of real notEqualTo and isIn operators
    packNotEqualsTest:packNotEqualsTest,
    packIsInTest:packIsInTest,
};

