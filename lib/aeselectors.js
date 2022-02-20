#!/usr/bin/env node

'use strict';

// aeselectors

// note: if implementing async support (assuming this is practical in Node, given it requires an AppKit main event loop to receive the reply events), a completion callback should be passed as second argument to async command call, e.g. `specifier.command({...},function(error,result){...})` (the outgoing AE's kAEQueueReply send flag set automatically)

const util = require('util');

const objc = require('objc');

const aesupport = require('./aesupport');
const aeformatter = require('./aeformatter');
const kae = require('./kae');


/****************************************************************************************/
// functions invoked when a specifier object is called; attached to specifier record


function getDataCommand(appData, parentSpecifierRecord, parametersObject) { // OBJSPEC(…) = shorthand for OBJSPEC.get(…)
    const commandDef = {name:'get', eventClass:kae.kAECoreSuite, eventID:kae.kAEGetData, params:{}};
    return appData.sendAppleEvent(commandDef, parentSpecifierRecord, parametersObject);
}


function callSubroutine(appData, parentSpecifierRecord, parametersObject) { // OBJSPEC.USERPROPERTY(…) is converted to OBJSPEC.USERCOMMAND(…)
    parametersObject = Object.assign({_:[]}, parametersObject);
    const directParameter = parametersObject._;
    if (!Array.isArray(directParameter)) {
        throw new TypeError(`Bad direct parameter in "$${specifier.seld}(...)" subroutine call ` +
                `(expected an Array of zero or more positional parameters): ${aesupport.formatValue(directParameter)}`);
    }
    const name = parametersObject[kae.keyASSubroutineName] = parentSpecifierRecord.seld;
    const commandDef = {name:name, eventClass:kae.kAECoreSuite, eventID:kae.kASSubroutineEvent, params:{}};
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
    return typeof value === 'object'  && value[aesupport.__appData] !== undefined;
}


/****************************************************************************************/
// Pack specifier records into AEDescs

function packSpecifier(appData, specifierRecord) { // packs specifierRecord field into AEDesc; this is just a convenience function to make the specifier record ADT easier to use
    return specifierRecord.pack(appData, specifierRecord);
}

function packObjectSpecifier(appData, specifierRecord) {
    if (specifierRecord.cachedDesc) { return specifierRecord.cachedDesc; }
    const desc = objc.NSAppleEventDescriptor.recordDescriptor().coerceToDescriptorType_(kae.typeObjectSpecifier);
    desc.setDescriptor_forKeyword_(packSpecifier(appData, specifierRecord.from), kae.keyAEContainer);
    desc.setDescriptor_forKeyword_(appData.pack(specifierRecord.want), kae.keyAEDesiredClass);
    desc.setDescriptor_forKeyword_(specifierRecord.form, kae.keyAEKeyForm);
    desc.setDescriptor_forKeyword_(appData.pack(specifierRecord.seld), kae.keyAEKeyData);
    specifierRecord.cachedDesc = desc;
    return desc;
}

function packInsertionSpecifier(appData, specifierRecord) {
    if (specifierRecord.cachedDesc) { return specifierRecord.cachedDesc; }
    const desc = objc.NSAppleEventDescriptor.recordDescriptor().coerceToDescriptorType_(kae.typeInsertionLoc);
    desc.setDescriptor_forKeyword_(packSpecifier(appData, specifierRecord.from), kae.keyAEObject);
    desc.setDescriptor_forKeyword_(appData.pack(specifierRecord.seld), kae.keyAEPosition);
    specifierRecord.cachedDesc = desc;
    return desc;
}


// pack start/stop argument in by-range specifier

function packRangeStartStop(appData, value, wantDesc) {
    if (isSpecifier(value)) { // note: this doesn't exclude its-based specifiers but it's unlikely user would pass one here by accident so not too worried; receiving apps should return error on receiving obviously invalid params
        return value[aesupport.__packSelf](appData);
    }
    var form, seld;
    switch (typeof value) { // treat integer/string as shortcut for by-index/by-name specifier relative to container // TO DO: FIX
    case 'number':
        form = aesupport.formAbsolutePositionDesc;
        seld = objc.NSAppleEventDescriptor.descriptorWithInt32_(aesupport.SInt32(value));
        break;
    case 'string':
        form = aesupport.formNameDesc;
        seld = objc.NSAppleEventDescriptor.descriptorWithString_(value);
        break;
    default: // bad start/stop argument type for SPECIFIER.thru() selector
        throw new TypeError(`Bad range selector: ${aeformatter.formatValue(value)}`);
    } // fall-thru to pack the index/name value as con-based objspec descriptor
    const desc = objc.NSAppleEventDescriptor.recordDescriptor().coerceToDescriptorType_(kae.typeObjectSpecifier);
    desc.setDescriptor_forKeyword_(aesupport.kConRootDesc, kae.keyAEContainer);
    desc.setDescriptor_forKeyword_(wantDesc, kae.keyAEDesiredClass);
    desc.setDescriptor_forKeyword_(form, kae.keyAEKeyForm);
    desc.setDescriptor_forKeyword_(seld, kae.keyAEKeyData);
    return desc;
}


// pack test clause

function packComparisonSpecifier(appData, specifierRecord) {
    if (specifierRecord.cachedDesc) { return specifierRecord.cachedDesc; }
    const desc = objc.NSAppleEventDescriptor.recordDescriptor().coerceToDescriptorType_(kae.typeCompDescriptor);
    desc.setDescriptor_forKeyword_(specifierRecord.form, kae.keyAECompOperator);
    desc.setDescriptor_forKeyword_(packSpecifier(appData, specifierRecord.from), kae.keyAEObject1);
    desc.setDescriptor_forKeyword_(appData.pack(specifierRecord.seld), kae.keyAEObject2);
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
    const desc = objc.NSAppleEventDescriptor.recordDescriptor().coerceToDescriptorType_(kae.typeCompDescriptor);
    desc.setDescriptor_forKeyword_(specifierRecord.form, kae.keyAECompOperator);
    desc.setDescriptor_forKeyword_(appData.pack(specifierRecord.seld), kae.keyAEObject1);
    desc.setDescriptor_forKeyword_(packSpecifier(appData, specifierRecord.from), kae.keyAEObject2);
    specifierRecord.cachedDesc = desc;
    return desc;
}

function packLogicalTest(appData, specifierRecord) {
    if (specifierRecord.cachedDesc) { return specifierRecord.cachedDesc; }
    const listDesc = objc.NSAppleEventDescriptor.listDescriptor();
    listDesc.insertDescriptor_atIndex_(packSpecifier(appData, specifierRecord.from), 0);
    for (var item of specifierRecord.seld) {
        try {
            const itemDesc = item[aesupport.__packSelf](appData); // (fails if an arg is obviously wrong type)
            const descType = itemDesc.descriptorType(); // (though we'll still explicitly check to be sure)
            if (descType != kae.typeCompDescriptor && descType != kae.typeLogicalDescriptor) {
                throw new TypeError(`Wrong descriptor type: ${aesupport.formatFourCharString(descType)}`);
            }
            listDesc.insertDescriptor_atIndex_(itemDesc, 0);
        } catch (e) {
            throw new aeerrors.ParameterError(item, String(e));
        }
    }
    const desc = objc.NSAppleEventDescriptor.recordDescriptor().coerceToDescriptorType_(kae.typeLogicalDescriptor);
    desc.setDescriptor_forKeyword_(specifierRecord.form, kae.keyAELogicalOperator);
    desc.setDescriptor_forKeyword_(listDesc, kae.keyAELogicalTerms);
    specifierRecord.cachedDesc = desc;
    return desc;
}

function packNOTTest(parentTestDesc) {
    const listDesc = objc.NSAppleEventDescriptor.listDescriptor();
    listDesc.insertDescriptor_atIndex_(parentTestDesc, 0);
    const desc = objc.NSAppleEventDescriptor.recordDescriptor().coerceToDescriptorType_(kae.typeLogicalDescriptor);
    desc.setDescriptor_forKeyword_(aesupport.kAENOTDesc, kae.keyAELogicalOperator);
    desc.setDescriptor_forKeyword_(listDesc, kae.keyAELogicalTerms);
    return desc;
}


// pack an untargeted app/con/its-based specifier; the targeted AppData is supplied by the targeted specifier in which it is used, and provides terminology tables needed to convert its unresolved names (stored in records' 'want' slot) to four-char codes so that it can be packed into records

function packUntargetedObjectSpecifier(targetedAppData, specifierRecord) { // targeted appData provides terminology tables
    if (specifierRecord.cachedDesc) { return specifierRecord.cachedDesc; }
    var want, form, seld;
    const name = specifierRecord.want.name;
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
    const desc = objc.NSAppleEventDescriptor.recordDescriptor().coerceToDescriptorType_(
                                                                 kae.typeObjectSpecifier);
    desc.setDescriptor_forKeyword_(packSpecifier(targetedAppData, specifierRecord.from), kae.keyAEContainer);
    desc.setDescriptor_forKeyword_(targetedAppData.pack(want), kae.keyAEDesiredClass);
    desc.setDescriptor_forKeyword_(form, kae.keyAEKeyForm);
    desc.setDescriptor_forKeyword_(targetedAppData.pack(seld), kae.keyAEKeyData);
    specifierRecord.cachedDesc = desc;
    return desc;
}


// when selector properties/methods are called on a specifier, they 'steal' the value of that specifier's existing 'want' slot; in a targeted specifier this is a typeType descriptor containing the element's four-char code obtained from its AppData, but in an untargeted specifier there is no AppData so the lookup must be deferred

class UntargetedWantValue {

	constructor(name) {
		this.name = name;
	}
	
    [Symbol.toString]() { return this.name; }
    
    [aesupport.__packSelf](targetedAppData) {
        const codeDesc = targetedAppData.elementsDescriptorByName(this.name);
        if (!codeDesc) { throw new Error(`Unknown elements name: "${this.name}"`); }
        return codeDesc;
    }
}


/****************************************************************************************/
// constructors for selector tables' attributes/methods (first/middle/last, at/named/where, etc)


function _newInsertionAttribute(selectorDataDesc) {
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

function _newRelativeSelectorMethod(selectorDataDesc) {
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

function _newManyToOneSelectorAttribute(formDesc, selectorDataDesc) {
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

function _newManyToOneSelectorMethod(formDesc) {
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

function _newRangeSpecifier(appData, parentSpecifierRecord, start, stop) {
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


class Range {
	constructor(start, stop, defaultWant) { // {start:OBJSPEC,stop:OBJSPEC} constructor; used in by-range specifiers
		this.start = start;
		this.stop = stop;
		this.defaultWant = defaultWant;
	}
    [aesupport.__packSelf](appData) {
        const desc = objc.NSAppleEventDescriptor.recordDescriptor().coerceToDescriptorType_(
                                                                     kae.typeRangeDescriptor);
        desc.setDescriptor_forKeyword_(packRangeStartStop(appData, this.start, this.defaultWant), kae.keyAERangeStart);
        desc.setDescriptor_forKeyword_(packRangeStartStop(appData, this.stop, this.defaultWant), kae.keyAERangeStop);
        return desc;
    };
    
    [Symbol.toString]() { return `${this.start},${this.stop}`; };
}


// test clauses

function _newTestSpecifierMethod(operatorDesc, packMethod = packComparisonSpecifier) { // lessThan, equalTo, isIn, etc
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

function _newLogicalTestSpecifierMethod(operatorDesc) { // and, or
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
    [aesupport.__getCommand]: function(appData, parentSpecifierRecord, name) {
        const commandDef = appData.commandDefinitionByName(name);
        if (!commandDef) { return null; } // not found
        return function(parametersObject = {}) {
            return appData.sendAppleEvent(commandDef, parentSpecifierRecord, parametersObject);
        };
    }
};


const _specifierConstructors = { // appear on all app, con, its specifiers
    [aesupport.__getUserProperty]: function(appData, parentSpecifierRecord, name) {
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
    [aesupport.__getProperty]: function(appData, parentSpecifierRecord, name) {
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
    [aesupport.__getElements]: function(appData, parentSpecifierRecord, name) {
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
    [aesupport.__getUnknownName]: function(appData, parentSpecifierRecord, name) {
        // we can't know if an attribute is property or all-elements name until terminology is available, so for now construct as if it's all-elements specifier as that has full set of selectors
        return newSpecifier(appData, {
                    from:parentSpecifierRecord,
                    want:new UntargetedWantValue(name),
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
    "beginning": _newInsertionAttribute(aesupport.kAEBeginningDesc),
    "end": _newInsertionAttribute(aesupport.kAEEndDesc),
    "before": _newInsertionAttribute(aesupport.kAEBeforeDesc),
    "after": _newInsertionAttribute(aesupport.kAEAfterDesc),
    // relative position; these return a function that takes optional argument[s] that provide prop
    "previous": _newRelativeSelectorMethod(aesupport.kAEPreviousDesc),
    "next": _newRelativeSelectorMethod(aesupport.kAENextDesc),
};


const multipleElementSelectors = Object.assign({ // these are available on all-elements specifiers, and on multi-element specifiers returned by thru/slice (by-range) and where (by-test)
    // select single element
    // following should return new specifier Proxy
    "first": _newManyToOneSelectorAttribute(aesupport.formAbsolutePositionDesc, aesupport.kAEFirstDesc),
    "middle": _newManyToOneSelectorAttribute(aesupport.formAbsolutePositionDesc, aesupport.kAEMiddleDesc),
    "last": _newManyToOneSelectorAttribute(aesupport.formAbsolutePositionDesc, aesupport.kAELastDesc),
    "any": _newManyToOneSelectorAttribute(aesupport.formAbsolutePositionDesc, aesupport.kAEAnyDesc),
    // following should return function that takes the argument[s] that provide seld
    "at": _newManyToOneSelectorMethod(aesupport.formAbsolutePositionDesc),
    [aesupport.__getZeroIndexSelector]: function(appData, parentSpecifierRecord, name) {
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
    "named": _newManyToOneSelectorMethod(aesupport.formNameDesc),
    "ID": _newManyToOneSelectorMethod(aesupport.formUniqueIDDesc),
    // select multiple elements
    "thru": function(appData, parentSpecifierRecord) {
        return function(start, stop = -1) {
            return _newRangeSpecifier(appData, parentSpecifierRecord, start, stop);
        };
    },
    "slice": function(appData, parentSpecifierRecord) {
        return function(fromIndex, toIndex = -1) { // ELEMENTS.slice(INT,INT) = zero-indexed shortcut for `thru()`
            return _newRangeSpecifier(appData, parentSpecifierRecord,
                                     aesupport.convertZeroToOneIndex(fromIndex), 
                                     aesupport.convertZeroToOneIndex(toIndex));
        };
    },
    "where": function(appData, parentSpecifierRecord) { // aka 'whose'
        return function(testClause) {
            const testAppData = testClause[aesupport.__appData]; // confirm testClause is its-based specifier
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
                    selectors:appData.multipleElementsSpecifierAttributes,
                    call:getDataCommand,
                    pack:packObjectSpecifier});

        }
    },
}, singleElementSelectors);



// its-based specifiers

const comparisonTestConstructors = { // available on its-based specifiers; all return a closure that takes second operand
    "lt":         _newTestSpecifierMethod(aesupport.kAELessThanDesc),
    "le":         _newTestSpecifierMethod(aesupport.kAELessThanEqualsDesc),
    "eq":         _newTestSpecifierMethod(aesupport.kAEEqualsDesc),
    "ne":         _newTestSpecifierMethod(aesupport.kAEEqualsDesc, packNotEqualsTest), // pack as !(op1==op2)
    "gt":         _newTestSpecifierMethod(aesupport.kAEGreaterThanDesc),
    "ge":         _newTestSpecifierMethod(aesupport.kAEGreaterThanEqualsDesc),
    "beginsWith": _newTestSpecifierMethod(aesupport.kAEBeginsWithDesc),
    "endsWith":   _newTestSpecifierMethod(aesupport.kAEEndsWithDesc),
    "contains":   _newTestSpecifierMethod(aesupport.kAEContainsDesc),
    "isIn":       _newTestSpecifierMethod(aesupport.kAEContainsDesc, packIsInTest), // pack as op2.contains(op1)
};


const logicalTestConstructors = { // available on comparison and logical tests
    "and": _newLogicalTestSpecifierMethod(aesupport.kAEANDDesc),
    "or":  _newLogicalTestSpecifierMethod(aesupport.kAEORDesc),
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
	// TO DO: REPL insists on displaying 'Proxy [ REFERENCE , handler-obj ]' instead of 'REFERENCE'; how to fix this?
	function specifierProxy() {}
    specifierProxy.appData = appData,
    specifierProxy.specifierRecord = specifierRecord,
    specifierProxy[util.inspect.custom] = function () { 
		return aeformatter.formatSpecifierRecord(appData, specifierRecord); 
	};
    // specifier records are ADTs
    return new Proxy(specifierProxy, { 
        apply: function(target, thisArg, argumentsList) { // this may be a convenience shortcut for SPECIFIER.get(...argumentsList), where permitted, or a SPECIFIER.$NAME(...argumentsList) subroutine call
            if (appData.targetType === null) {
                throw new Error(`Unsupported selector/command on its/con-based specifier:\n\n\t${ aeformatter.formatSpecifierRecord(appData, specifierRecord) }(${ argumentsList.map(aeformatter.formatValue).join() })\n`);
            }
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
            case Symbol.toStringTag:
            	return 'nodeautomation.Specifier';
            case Symbol.toString:
            case Symbol.toPrimitive:
            case util.inspect.custom:
            case "toString":
            	// TO DO: 
                return function() { 
                
                	return aeformatter.formatSpecifierRecord(appData, specifierRecord);
                };
            case [Symbol.valueOf]:
            case "valueOf": // TO DO: needed? appropriate?
            case "constructor":
                return undefined;
            case aesupport.__packSelf:
                return function(appData) { // note: AppData instance that passes itself here is already targeted
                    return specifierRecord.pack(appData, specifierRecord);
                };
            case aesupport.__appData:
                return appData;
            case aesupport.__specifierRecord:
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
            for (let key of [aesupport.__getProperty,
							 aesupport.__getElements,
							 aesupport.__getCommand,
							 aesupport.__getZeroIndexSelector,
							 aesupport.__getUserProperty,
							 aesupport.__getUnknownName]) { // important: __unknownName__ must be tested for last as it's the catchall for untargeted specifiers' names
                let specialFunc = specifierRecord.selectors[key];
                if (specialFunc) {
                    const childSpecifier = specialFunc(appData, specifierRecord, name);
                    if (childSpecifier) { return childSpecifier; }
                }
            }
            throw new TypeError(`Unknown property/elements/command name: ${aeformatter.formatValue(name)}`);
        },
        set: function(target, name, value) {
        	// TO DO: there is some argument for aliasing `=` assignment operator to `set` command, as `.set({to:VALUE})` is tedious to type; it won't work in all use cases, e.g. JS parser doesn't allow `=` after parens, e.g. `foo.selector() = bar`, but that's rare (btw, `.set(VALUE)` isn't a viable shorthand as there's no way for JS to distinguish between a parameters object and an object passed as a parameter [rb-appscript had the same problem, and the rules on what was considered a parameters object vs an object passed as parameter were complicated and easy to forget/break])
        	throw new Error("Can't assign to reference. Did you mean: reference.NAME.set({to: VALUE})");
        },
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
    targetedAppRootTables, // can construct app(…)-based specifiers and also call commands on them
    untargetedAppRootTables, // can construct app-based specifiers
    untargetedConRootTables, // can construct con-based specifiers
    untargetedItsRootTables, // can construct its-based specifiers, containment/comparison tests
    doNotCall, 
    getDataCommand,
    newSpecifier,
    packSpecifier,
    isSpecifier,
    
    Range, // used in unpack
    newRootSpecifier,
    newRootSpecifierRecord,
    newCustomRootSpecifierRecord,
    
    packCachedDesc, // also used in AppData to minimize unpack+repack
    
    // formatter needs the following to compensate for lack of real notEqualTo and isIn operators
    packNotEqualsTest,
    packIsInTest,
};

