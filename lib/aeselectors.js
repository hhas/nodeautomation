#!/usr/bin/env node

'use strict';

// aeselectors

// note: if implementing async support (assuming this is practical in Node, given it requires an AppKit main event loop to receive the reply events), a completion callback should be passed as second argument to async command call, e.g. `specifier.command({...},function(error,result){...})` (the outgoing AE's kAEQueueReply send flag set automatically)

const util = require('util');

const objc = require('objc');

const aesupport = require('./aesupport');
const aeerrors = require('./aeerrors');
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
    return aesupport.isAllElementsEnum(specifierRecord.seld) ? specifierRecord.from : specifierRecord;
}


function isSpecifier(value) {
    return value?.[aesupport.__specifierRecord] !== undefined;
}


// AEDescs used to terminate object specifier record chains
const kAppRootDesc = new aesupport.AEOpaqueDescriptor(kae.typeNull);
const kConRootDesc = new aesupport.AEOpaqueDescriptor(kae.typeCurrentContainer);
const kItsRootDesc = new aesupport.AEOpaqueDescriptor(kae.typeObjectBeingExamined);


function packCachedDesc(aeBuffer, appData, specifierRecord) {
	aeBuffer.writeBuffer(specifierRecord.cachedDesc);
}

// used in packRangeStartStop
const conRootBuffer = Buffer.allocUnsafe(8);
conRootBuffer.writeUInt32BE(kae.typeCurrentContainer);
conRootBuffer.writeUInt32BE(0);


/****************************************************************************************/
// Pack specifier records into AEDescs

// TO DO: compare AEStream API


// pack an untargeted app/con/its-based specifier; the targeted AppData is supplied by the targeted specifier in which it is used, and provides terminology tables needed to convert its unresolved names (stored in records' 'want' slot) to four-char codes so that it can be packed into records

function packUntargetedObjectSpecifier(aeBuffer, appData, specifierRecord) {
	// targeted appData provides terminology tables
	// TO DO: confirm this doesn't break anything by mutating app./con./its. specifiers in-place
	if (specifierRecord.cachedDesc) {
    	aeBuffer.writeBuffer(specifierRecord.cachedDesc);
    } else {
		const name = specifierRecord.want; // untargeted specifiers temporarily store property/elements name in 'want'
		let want, form, seld, code = appData.propertyCodeForName(name);
		if (code !== undefined) { // is it a property name?, if it is, return `PROPERTY of PARENTSPECIFIER`
			if (!aesupport.isAllElementsEnum(specifierRecord.seld)) { // both `.property` and `.elements` initially put attribute name string in 'want' property and kAllKeyword in 'seld' property
				throw new TypeError(`Can't call selector methods on "${name}" property.`); // TO DO: is this right? or should it switch to packing as an elements specifier? (the problem here is conflicting keyword definitions, where a name is defined both as a type and a property; e.g. `text` is both a property and a type, and there is no plural `texts` keyword to disambiguate - that particular case is specially handled, as that seems to be how AS treats it; another option would be to provide a disambiguating `.all` attribute that, when explicitly applied to a property specifier, converts it to an all-elements specifier)
			}
			specifierRecord.want = kae.typeProperty;
			specifierRecord.form = kae.formPropertyID;
			specifierRecord.seld = new aesupport.Keyword(code, kae.typeType);
		} else { // otherwise see if it's an elements name
			code = appData.elementsCodeForName(name);
			if (code === undefined) {
				throw new Error(`Unknown property/elements name: "${name}"`);
			}
			specifierRecord.want = code;
		}
		packObjectSpecifier(aeBuffer, appData, specifierRecord);
	}
}

// pack targeted specifier

function packObjectSpecifier(aeBuffer, appData, specifierRecord) {
    if (specifierRecord.cachedDesc) {
    	aeBuffer.writeBuffer(specifierRecord.cachedDesc);
    } else {
    	const descriptorStartOffset = aeBuffer.offset;
		aeBuffer.writeUInt32BE(kae.typeObjectSpecifier);
		const dataSizeOffset = aeBuffer.allocate(4); // data size (TBC)
		const dataStartOffset = aeBuffer.offset;
		aeBuffer.writeUInt32BE(4); // count of record properties
		aeBuffer.writeUInt32BE(0); // 4-byte padding
		// want (type)
		aeBuffer.writeUInt32BE(kae.keyAEDesiredClass); // key
		aeBuffer.writeUInt32BE(kae.typeType); // type
		aeBuffer.writeUInt32BE(4); // size
		aeBuffer.writeUInt32BE(specifierRecord.want); // OSType
		// form (enum)
		aeBuffer.writeUInt32BE(kae.keyAEKeyForm);
		aeBuffer.writeUInt32BE(kae.typeEnumerated);
		aeBuffer.writeUInt32BE(4);
		aeBuffer.writeUInt32BE(specifierRecord.form);
		// seld (any)
		aeBuffer.writeUInt32BE(kae.keyAEKeyData);
		appData._writeDescriptor(aeBuffer, specifierRecord.seld);
		// from (typeObjectSpecifier/typeNull/typeCurrentContainer/typeObjectBeingExamined/anything [custom root])
		aeBuffer.writeUInt32BE(kae.keyAEContainer);
		specifierRecord.from.pack(aeBuffer, appData, specifierRecord.from); // TO DO: check this is right (it should be, as long as 'from' property is another specifier record object)
		const descriptorEndOffset = aeBuffer.offset;
		aeBuffer.rawBuffer.writeUInt32BE(descriptorEndOffset - dataStartOffset, dataSizeOffset); // write data size
		specifierRecord.cachedDesc = aeBuffer.rawBuffer.subarray(descriptorStartOffset, descriptorEndOffset); // cache for reuse; caution: this currently retains the entire rawBuffer (which includes all data previously written to it, and all data that will be written to it up to next _grow and/or random data if the buffer was created using allocUnsafe) might have memory consumption/safety issues; also, retaining entire buffers for extended periods of time will prevent Buffer putting those large buffers back into reusable pool, so we might want to calculate descriptor size divided by buffer size, and if it's a large buffer containing a small descriptor then copy that descriptor to its own buffer so that the large buffer can be released back to pool
    }
}

function packInsertionSpecifier(aeBuffer, appData, specifierRecord) {
    if (specifierRecord.cachedDesc) {
    	aeBuffer.writeBuffer(specifierRecord.cachedDesc);
    } else {
    	const descriptorStartOffset = aeBuffer.offset;
		aeBuffer.writeUInt32BE(kae.typeInsertionLoc);
		const dataSizeOffset = aeBuffer.allocate(4); // data size (TBC)
		const dataStartOffset = aeBuffer.offset;
		aeBuffer.writeUInt32BE(2); // count of record properties
		aeBuffer.writeUInt32BE(0); // 4-byte padding
		// from (objspec)
		aeBuffer.writeUInt32BE(kae.keyAEObject);
		specifierRecord.from.pack(aeBuffer, appData, specifierRecord.from);
		// position (beginning/end/before/after)
		aeBuffer.writeUInt32BE(kae.keyAEPosition);
		aeBuffer.writeUInt32BE(kae.typeEnumerated);
		aeBuffer.writeUInt32BE(4);
		aeBuffer.writeUInt32BE(specifierRecord.seld); // seld is kAEBeginning/kAEEnd/kAEBefore/kAEAfter
		const descriptorEndOffset = aeBuffer.offset;
		aeBuffer.rawBuffer.writeUInt32BE(descriptorEndOffset - dataStartOffset, dataSizeOffset); // write data size
		specifierRecord.cachedDesc = aeBuffer.rawBuffer.subarray(descriptorStartOffset, descriptorEndOffset);
    }
}


// pack start/stop argument in by-range specifier

function packRangeStartStop(aeBuffer, appData, value, parentWant) { // TO DO: parentWant will be OSType
    if (isSpecifier(value)) { // note: this doesn't exclude its-based specifiers but it's unlikely user would pass one here by accident so not too worried; receiving apps should return error on receiving obviously invalid params
        return value[aesupport.__packSelf](aeBuffer, appData);
    }
    // treat integer/string as shortcut for by-index/by-name specifier relative to container
    let form;
    if (aesupport.isNumber(value)) {
        form = kae.formAbsolutePosition;
    } else if (aesupport.isString(value)) {
        form = kae.formName;
    } else { // bad start/stop argument type for SPECIFIER.thru() selector
        throw new TypeError(`Bad range selector: ${aeformatter.formatValue(value)}`);
    }
    packObjectSpecifier(aeBuffer, appData, {want: parentWant, form: form, seld: value, 
    					 from: {cachedDesc: conRootBuffer, pack: packCachedDesc}});
}


// pack test clause

function packComparisonSpecifier(aeBuffer, appData, specifierRecord) { // op1.OPERATOR(op2)
    if (specifierRecord.cachedDesc) {
    	aeBuffer.writeBuffer(specifierRecord.cachedDesc);
    } else {
    	const descriptorStartOffset = aeBuffer.offset;
		aeBuffer.writeUInt32BE(kae.typeCompDescriptor);
		const dataSizeOffset = aeBuffer.allocate(4); // data size (TBC)
		const dataStartOffset = aeBuffer.offset;
		aeBuffer.writeUInt32BE(3); // count of record properties
		aeBuffer.writeUInt32BE(0); // 4-byte padding
		// operator
		aeBuffer.writeUInt32BE(kae.keyAECompOperator);
		aeBuffer.writeUInt32BE(kae.typeEnumerated);
		aeBuffer.writeUInt32BE(4);
		aeBuffer.writeUInt32BE(specifierRecord.form);
		// left operand
		aeBuffer.writeUInt32BE(kae.keyAEObject1);
		specifierRecord.from.pack(aeBuffer, appData, specifierRecord.from);
		// right operand
		aeBuffer.writeUInt32BE(kae.keyAEObject2);
		appData._writeDescriptor(aeBuffer, specifierRecord.seld);
		const descriptorEndOffset = aeBuffer.offset;
		aeBuffer.rawBuffer.writeUInt32BE(descriptorEndOffset - dataStartOffset, dataSizeOffset); // write data size
		specifierRecord.cachedDesc = aeBuffer.rawBuffer.subarray(descriptorStartOffset, descriptorEndOffset);
	}
}

function packIsInTest(aeBuffer, appData, specifierRecord) { // there is no kAEIsIn so pack as `op2.contains(op1)`; this is identical to packComparisonSpecifier except values of keyAEObject1 and keyAEObject2 properties are transposed
    if (specifierRecord.cachedDesc) {
    	aeBuffer.writeBuffer(specifierRecord.cachedDesc);
    } else {
    	const descriptorStartOffset = aeBuffer.offset;
		aeBuffer.writeUInt32BE(kae.typeCompDescriptor);
		const dataSizeOffset = aeBuffer.allocate(4); // data size (TBC)
		const dataStartOffset = aeBuffer.offset;
		aeBuffer.writeUInt32BE(3); // count of record properties
		aeBuffer.writeUInt32BE(0); // 4-byte padding
		// operator
		aeBuffer.writeUInt32BE(kae.keyAECompOperator);
		aeBuffer.writeUInt32BE(kae.typeEnumerated);
		aeBuffer.writeUInt32BE(4);
		aeBuffer.writeUInt32BE(specifierRecord.form);
		// left operand
		aeBuffer.writeUInt32BE(kae.keyAEObject1);
		appData._writeDescriptor(aeBuffer, specifierRecord.seld);
		// right operand
		aeBuffer.writeUInt32BE(kae.keyAEObject2);
		specifierRecord.from.pack(aeBuffer, appData, specifierRecord.from);
		const descriptorEndOffset = aeBuffer.offset;
		aeBuffer.rawBuffer.writeUInt32BE(descriptorEndOffset - dataStartOffset, dataSizeOffset); // write data size
		specifierRecord.cachedDesc = aeBuffer.rawBuffer.subarray(descriptorStartOffset, descriptorEndOffset);
	}
}

function packNotEqualsTest(aeBuffer, appData, specifierRecord) { // there is no kAENotEquals so pack as kAEEquals+kAENOT
	const parentSpecifierRecord = Object.create(specifierRecord);
	parentSpecifierRecord.form = kae.kAEEquals;
	packLogicalTest(aeBuffer, appData, {
				from: parentSpecifierRecord, // left operand
				form: kae.kAENOT, // operator
				seld: [],
				cachedDesc: null, 
				selectors: logicalTestConstructors,
				call: doNotCall,
				pack: packLogicalTest});
}

function packLogicalTest(aeBuffer, appData, specifierRecord) {
    if (specifierRecord.cachedDesc) {
    	aeBuffer.writeBuffer(specifierRecord.cachedDesc);
    } else {
    	const descriptorStartOffset = aeBuffer.offset;
		aeBuffer.writeUInt32BE(kae.typeLogicalDescriptor);
		const dataSizeOffset = aeBuffer.allocate(4); // data size (TBC)
		const dataStartOffset = aeBuffer.offset;
		aeBuffer.writeUInt32BE(2); // count of record properties
		aeBuffer.writeUInt32BE(0); // 4-byte padding
		// operator
		aeBuffer.writeUInt32BE(kae.keyAELogicalOperator);
		aeBuffer.writeUInt32BE(kae.typeEnumerated);
		aeBuffer.writeUInt32BE(4);
		aeBuffer.writeUInt32BE(specifierRecord.form);
		// operands
		aeBuffer.writeUInt32BE(kae.keyAELogicalTerms);
		// we could call appData._writeDescriptor(specifierRecord.seld), but that won't check operand types are correct
		aeBuffer.writeUInt32BE(kae.typeAEList);
		const listDataSizeOffset = aeBuffer.allocate(4); // data size (TBC)
		const listDataStartOffset = aeBuffer.offset;
		aeBuffer.writeUInt32BE(specifierRecord.seld.length+1); // count of items in list
		aeBuffer.writeUInt32BE(0); // 4-byte padding
		// first item is always left operand on which this logical test was called (i.e. another test specifier)
		specifierRecord.from.pack(aeBuffer, appData, specifierRecord.from);
		for (let item of specifierRecord.seld) {
			try {
				const itemDescriptorTypeOffset = aeBuffer.offset;
				appData._writeDescriptor(aeBuffer, item);
				// check the packed desc is correct type
				const descType = aeBuffer.rawBuffer.readUInt32BE(itemDescriptorTypeOffset);
				if (descType !== kae.typeCompDescriptor && descType !== kae.typeLogicalDescriptor) {
					throw new TypeError(`Not a test descriptor: ${aesupport.formatFourCharString(descType)}`);
				}
			} catch (e) {
				throw new aeerrors.ParameterError(item, String(e));
			}
		}
		const descriptorEndOffset = aeBuffer.offset;
		aeBuffer.rawBuffer.writeUInt32BE(descriptorEndOffset - listDataStartOffset, listDataSizeOffset); // list size
		aeBuffer.rawBuffer.writeUInt32BE(descriptorEndOffset - dataStartOffset, dataSizeOffset); // write record size
		specifierRecord.cachedDesc = aeBuffer.rawBuffer.subarray(descriptorStartOffset, descriptorEndOffset);
	}
}


/****************************************************************************************/
// constructors for selector tables' attributes/methods (first/middle/last, at/named/where, etc)


function _newInsertionAttribute(locationCode) {
    return function(appData, parentSpecifierRecord) {
        return newSpecifier(appData, {
                from: parentSpecifierRecord,
                seld: locationCode,
                cachedDesc: null, 
                selectors: appData.insertionSpecifierAttributes,
                call: doNotCall,
                pack: packInsertionSpecifier});
    };
}

function _newRelativeSelectorMethod(relativeKeyword) { // kAEPrevious/kAENext
    return function(appData, parentSpecifierRecord) {
        return function(elementType = null) { // e.g. `k.word`, or null to use parent specifier's element type
            let want;
            if (elementType === null) {
                want = parentSpecifierRecord.want;
            } else if (aesupport.isKeyword(elementType)) {
            	want = elementType.name;
            	if (!aesupport.isNumber(want)) {
            		want = appData.typeCodeForName(elementType)?.code;
            		if (want === undefined) {
						throw new TypeError(
						`Bad previous/next argument (unknown keyword): ${aeformatter.formatValue(elementType)}`);
            		}
            	}
            } else {
                throw new TypeError(
                    `Bad previous/next argument (not a keyword): ${aeformatter.formatValue(elementType)}`);
            }
            return newSpecifier(appData, {
                    from: parentSpecifierRecord, // note: do not discard all-elements as, unlike others, this selector always applies to the parent specifier (AS sloppily allows `ELEMENT before/after every ELEMENT` queries to be constructed, even though apps should always reject them as logically nonsensical)
                    want: elementType,
                    form: kae.formRelativePosition, 
                    seld: relativeKeyword,
                    cachedDesc: null, 
                    selectors: appData.singleElementSpecifierAttributes,
                    call: getDataCommand,
                    pack: packObjectSpecifier});
        };
    };
}

function _newManyToOneSelectorAttribute(form, selectorDataDesc) { // .first, .last, etc
    return function(appData, parentSpecifierRecord) {
        return newSpecifier(appData, {
                from: discardAllElementsSpecifierRecord(parentSpecifierRecord),
                want: parentSpecifierRecord.want, // OSType
                form: form, // OSType
                seld: selectorDataDesc,
                cachedDesc: null, 
                selectors: appData.singleElementSpecifierAttributes,
                call: getDataCommand,
                pack: packObjectSpecifier});
    };
}

function _newManyToOneSelectorMethod(form) { // .named(...), .ID(...)
    return function(appData, parentSpecifierRecord) {
        return function(selectorData) {
            return newSpecifier(appData, {
                    from: discardAllElementsSpecifierRecord(parentSpecifierRecord),
                    want: parentSpecifierRecord.want, 
                    form: form, 
                    seld: selectorData,
                    cachedDesc: null, 
                    selectors: appData.singleElementSpecifierAttributes,
                    call: getDataCommand,
                    pack: packObjectSpecifier});
        };
    };
}

function _newRangeSpecifier(appData, parentSpecifierRecord, start, stop) {
    return newSpecifier(appData, { 
        from: discardAllElementsSpecifierRecord(parentSpecifierRecord),
        want: parentSpecifierRecord.want,
        form: kae.formRange, 
        seld: new Range(start, stop, parentSpecifierRecord.want),
        cachedDesc: null, 
        selectors: appData.multipleElementsSpecifierAttributes,
        call: getDataCommand,
        pack: packObjectSpecifier});
}


class Range {
	constructor(start, stop, defaultWant) { // {start:OBJSPEC,stop:OBJSPEC} constructor; used in by-range specifiers
		if (start === undefined || stop === undefined) {
			throw new Error(`Missing start/stop for range.`);
		}
		this.start = start;
		this.stop = stop;
		this.defaultWant = defaultWant;
	}
    [aesupport.__packSelf](aeBuffer, appData) {
    	const descriptorStartOffset = aeBuffer.offset;
		aeBuffer.writeUInt32BE(kae.typeRangeDescriptor);
		const dataSizeOffset = aeBuffer.allocate(4); // data size (TBC)
		const dataStartOffset = aeBuffer.offset;
		aeBuffer.writeUInt32BE(2); // count of record properties
		aeBuffer.writeUInt32BE(0); // 4-byte padding
		// start (objspec)
		aeBuffer.writeUInt32BE(kae.keyAERangeStart);
		packRangeStartStop(aeBuffer, appData, this.start, this.defaultWant);
		// stop (beginning/end/before/after)
		aeBuffer.writeUInt32BE(kae.keyAERangeStop);
        packRangeStartStop(aeBuffer, appData, this.stop, this.defaultWant);
		const descriptorEndOffset = aeBuffer.offset;
		aeBuffer.rawBuffer.writeUInt32BE(descriptorEndOffset - dataStartOffset, dataSizeOffset); // write data size
    };
    
    [Symbol.toString]() { return `${this.start},${this.stop}`; };
}


// test clauses

function _newComparisonTestSpecifierMethod(operator, packFn = packComparisonSpecifier) {
	// lt, eq, isIn, etc; however, not all comparisons have corresponding kAE constants so custom comparison packing functions must be used in those cases
    return function(appData, parentSpecifierRecord) {
        return function(rightOperand) {
            return newSpecifier(appData, {
                    from: parentSpecifierRecord, // left operand
                    form: operator, // operator
                    seld: rightOperand, // right operand
                    cachedDesc: null, 
                    selectors: logicalTestConstructors,
                    call: doNotCall,
                    pack: packFn});
        };
    };
}

function _newLogicalTestSpecifierMethod(operator) { // and/or/not
	if (operator === kae.kAENOT) { // 'not' is a property, so lacks the extra closure
		return function(appData, parentSpecifierRecord) {
			return newSpecifier(appData, {
					from: parentSpecifierRecord, // left operand
					form: operator, // operator
					seld: [],
					cachedDesc: null, 
					selectors: logicalTestConstructors,
					call: doNotCall,
					pack: packLogicalTest});
		};
	} else { // 'and'/'or'
		return function(appData, parentSpecifierRecord) {
			return function(...rightOperands) {
				if (rightOperands.length < 1) {
					throw new TypeError("'and'/'or' methods require one or more arguments.");
				}
				return newSpecifier(appData, {
						from: parentSpecifierRecord, // left operand
						form: operator, // operator
						seld: rightOperands, // right operands
						cachedDesc: null, 
						selectors: logicalTestConstructors,
						call: doNotCall,
						pack: packLogicalTest});
			};
		};
    }
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



const __getProperty          = Symbol('__getProperty');
const __getElements          = Symbol('__getElements');
const __getCommand           = Symbol('__getCommand');
const __getZeroIndexSelector = Symbol('__getZeroIndexSelector');
const __getUserProperty      = Symbol('__getUserProperty');
const __getUnknownName       = Symbol('__getUnknownName');


// absolute positions
const kFirstKeyword  = new aesupport.Keyword(kae.kAEFirst,  kae.typeAbsoluteOrdinal);
const kMiddleKeyword = new aesupport.Keyword(kae.kAEMiddle, kae.typeAbsoluteOrdinal);
const kLastKeyword   = new aesupport.Keyword(kae.kAELast,   kae.typeAbsoluteOrdinal);
const kAnyKeyword    = new aesupport.Keyword(kae.kAEAny,    kae.typeAbsoluteOrdinal);
const kAllKeyword    = new aesupport.Keyword(kae.kAEAll,    kae.typeAbsoluteOrdinal);




const targetedCommandConstructors = { // allow commands to be called on targeted app-based specifiers
    [__getCommand]: function(appData, parentSpecifierRecord, name) {
        const commandDef = appData.commandDefinitionForName(name);
        if (!commandDef) { return null; } // not found
        return function(parametersObject = {}) {
            return appData.sendAppleEvent(commandDef, parentSpecifierRecord, parametersObject);
        };
    }
};


const _specifierConstructors = { // appear on all app, con, its specifiers
    [__getUserProperty]: function(appData, parentSpecifierRecord, name) {
        // if name starts with $, e.g. SPECIFIER.$foo, it's an identifier-based property/subroutine name (we won't know which till it's called though, so return a proxy that acts as a property specifier unless it's called, in which case it changes to a subroutine call)
        if (aesupport.isString(name) && name.startsWith('$')) {
            // return proxy object that allows constructing either a sub-specifier or calling as subroutine
            return newSpecifier(appData, {
                    from: parentSpecifierRecord,
                    want: kae.typeProperty,
                    form: kae.formUserPropertyID,
                    seld: name.slice(1), // name minus the '$' prefix
                    cachedDesc: null,
                    selectors: appData.propertySpecifierAttributes,
                    call: callSubroutine, // e.g. SPECIFIER.$foo(…) sends a subroutine event 'foo' as subroutine name and SPECIFIER as subject attribute
                    pack: packObjectSpecifier});
        }
        return null; // not a user property/subroutine name
    },
    "property": function(appData, parentSpecifierRecord) { // specify a property by four-char code
        return function(fourCharCode) {
            return newSpecifier(appData, {
                    from: parentSpecifierRecord, 
                    want: kae.typeProperty, 
                    form: kae.formPropertyID, 
                    seld: new aesupport.Keyword(aesupport.parseFourCharCode(fourCharCode)),
                    cachedDesc: null, 
                    selectors: appData.propertySpecifierAttributes,
                    call: getDataCommand,
                    pack: packObjectSpecifier});
        };
    },
    "elements": function(appData, parentSpecifierRecord) { // specify [all] elements by four-char code
        return function(fourCharCode) {
            return newSpecifier(appData, {
                    from: parentSpecifierRecord, 
                    want: aesupport.parseFourCharCode(fourCharCode),
                    form: kae.formAbsolutePosition, 
                    seld: kAllKeyword,
                    cachedDesc: null, 
                    selectors: appData.multipleElementsSpecifierAttributes,
                    call: getDataCommand,
                    pack: packObjectSpecifier});
        };
    },
};


// root/property/element[s]

const targetedSpecifierConstructors = Object.assign({
    [__getProperty]: function(appData, parentSpecifierRecord, name) {
        const code = appData.propertyCodeForName(name);
        if (code !== undefined) { // is it a property name?, if it is, return `PROPERTY of PARENTSPECIFIER`
            return newSpecifier(appData, {
                                from: parentSpecifierRecord,
                                want: kae.typeProperty,  
                                form: kae.formPropertyID, 
                                seld: new aesupport.Keyword(code, kae.typeType), // TO DO: or typeProperty?
                                cachedDesc: null, 
                                selectors: appData.propertySpecifierAttributes,
                                call: getDataCommand,
                                pack: packObjectSpecifier});
        };
        return null; // not found
    },
    [__getElements]: function(appData, parentSpecifierRecord, name) {
        const code = appData.elementsCodeForName(name);
        if (code !== undefined) { // is it an elements name? if it is, return `every TYPECLASS of PARENTSPECIFIER`
            return newSpecifier(appData, {
                                from: parentSpecifierRecord, 
                                want: code,
                                form: kae.formAbsolutePosition, 
                                seld: kAllKeyword,
                                cachedDesc: null, 
                                selectors: appData.multipleElementsSpecifierAttributes,
                                call: getDataCommand,
                                pack: packObjectSpecifier});
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
    [__getUnknownName]: function(appData, parentSpecifierRecord, name) {
        // we can't know if an attribute is property or all-elements name until terminology is available, so for now construct as if it's all-elements specifier as that has full set of selectors
        return newSpecifier(appData, {
                    from: parentSpecifierRecord,
                    want: name, // string; this needs converted to OSType when packing specifier
                    form: kae.formAbsolutePosition,
                    seld: kAllKeyword,
                    untargetedAppData: appData,
                    cachedDesc: null, 
                    selectors: appData.multipleElementsSpecifierAttributes,
                    call: doNotCall,
                    pack: packUntargetedObjectSpecifier});
    },
}, _specifierConstructors);


// element[s]


const singleElementSelectors = {
    // insert at beginning/end of all elements (included here because AS is really loose about these)
    // following should return new specifier Proxy which provides commands only (insertions)
    "beginning": _newInsertionAttribute(kae.kAEBeginning),
    "end":       _newInsertionAttribute(kae.kAEEnd),
    "before":    _newInsertionAttribute(kae.kAEBefore),
    "after":     _newInsertionAttribute(kae.kAEAfter),
    // relative position; these return a function that takes optional argument[s] that provide prop
    "previous":  _newRelativeSelectorMethod(new aesupport.Keyword(kae.kAEPrevious, kae.typeEnumerated)),
    "next":      _newRelativeSelectorMethod(new aesupport.Keyword(kae.kAENext,     kae.typeEnumerated)),
};


const multipleElementSelectors = Object.assign({ // these are available on all-elements specifiers, and on multi-element specifiers returned by thru/slice (by-range) and where (by-test)
    // select single element
    // following should return new specifier Proxy
    "first":  _newManyToOneSelectorAttribute(kae.formAbsolutePosition, kFirstKeyword),
    "middle": _newManyToOneSelectorAttribute(kae.formAbsolutePosition, kMiddleKeyword),
    "last":   _newManyToOneSelectorAttribute(kae.formAbsolutePosition, kLastKeyword),
    "any":    _newManyToOneSelectorAttribute(kae.formAbsolutePosition, kAnyKeyword),
    // following should return function that takes the argument[s] that provide seld
    "at":     _newManyToOneSelectorMethod(kae.formAbsolutePosition),
    [__getZeroIndexSelector]: function(appData, parentSpecifierRecord, name) {
        if (name.match(/^-?[0-9]+$/)) { // use ELEMENTS[INT] for zero-indexed `at()` shortcut
            return newSpecifier(appData, {
                    from: discardAllElementsSpecifierRecord(parentSpecifierRecord),
                    want: parentSpecifierRecord.want,
                    form: kae.formAbsolutePosition, 
                    seld: aesupport.convertZeroToOneIndex(name),
                    cachedDesc: null, 
                    selectors: appData.singleElementSpecifierAttributes,
                    call: getDataCommand,
                    pack: packObjectSpecifier});
        } else {
            return null;
        }
    }, // always called; if present, checks if selector is digit[s] and returns by-index specifier if it is; else returns null and matching continues; not sure if this should be here or baked into main code (prob latter, along with keyword/string)
    "named": _newManyToOneSelectorMethod(kae.formName),
    "ID": _newManyToOneSelectorMethod(kae.formUniqueID),
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
            if (testAppData === undefined || testAppData.rootSpecifierDescriptor.type !== kae.typeObjectBeingExamined) {
                const parent = aeformatter.formatSpecifierRecord(appData, parentSpecifierRecord);
                const arg = aeformatter.formatValue(testClause);
                throw new TypeError(`Bad 'where' argument (not an its-based specifier) ${parent}.where(${arg})`);
            }
            return newSpecifier(appData, {
                    from: discardAllElementsSpecifierRecord(parentSpecifierRecord),
                    want: parentSpecifierRecord.want,
                    form: kae.formTest, 
                    seld: testClause,
                    cachedDesc: null, 
                    selectors: appData.multipleElementsSpecifierAttributes,
                    call: getDataCommand,
                    pack: packObjectSpecifier});

        }
    },
}, singleElementSelectors);



// its-based specifiers

const comparisonTestConstructors = { // available on its-based specifiers; all return a closure that takes second operand
    "lt":         _newComparisonTestSpecifierMethod(kae.kAELessThan),
    "le":         _newComparisonTestSpecifierMethod(kae.kAELessThanEquals),
    "eq":         _newComparisonTestSpecifierMethod(kae.kAEEquals),
    "ne":         _newComparisonTestSpecifierMethod(kae.kAEEquals, packNotEqualsTest), // pack as !(op1==op2)
    "gt":         _newComparisonTestSpecifierMethod(kae.kAEGreaterThan),
    "ge":         _newComparisonTestSpecifierMethod(kae.kAEGreaterThanEquals),
    "beginsWith": _newComparisonTestSpecifierMethod(kae.kAEBeginsWith),
    "endsWith":   _newComparisonTestSpecifierMethod(kae.kAEEndsWith),
    "contains":   _newComparisonTestSpecifierMethod(kae.kAEContains),
    "isIn":       _newComparisonTestSpecifierMethod(kae.kAEContains, packIsInTest), // pack as op2.contains(op1)
};


const logicalTestConstructors = { // available on comparison and logical tests
    "and": _newLogicalTestSpecifierMethod(kae.kAEAND), // op1.and(op2,...)
    "or":  _newLogicalTestSpecifierMethod(kae.kAEOR),  // op1.or(op2,...)
    "not": _newLogicalTestSpecifierMethod(kae.kAENOT), // op1.not // takes no arguments; TO DO: make it a method for consistency?
};


/****************************************************************************************/
// lookup tables used by specifier Proxy objects; these add selector attributes/methods (first, at, where, etc)


const targetedAppRootTables = {
    rootSpecifierDescriptor: kAppRootDesc,
    rootSpecifierAttributes: targetedRootSpecifierConstructors, // app(...); also provides lower-level sendAppleEvent()
    insertionSpecifierAttributes: targetedCommandConstructors,
    propertySpecifierAttributes: targetedSpecifierConstructors,
    singleElementSpecifierAttributes: Object.assign({}, targetedSpecifierConstructors, singleElementSelectors),
    multipleElementsSpecifierAttributes: Object.assign({}, targetedSpecifierConstructors, multipleElementSelectors),
};

const untargetedAppRootTables = {
    rootSpecifierDescriptor: kAppRootDesc,
    rootSpecifierAttributes: untargetedSpecifierConstructors, // app
    insertionSpecifierAttributes: {},
    propertySpecifierAttributes: untargetedSpecifierConstructors,
    singleElementSpecifierAttributes: Object.assign({}, untargetedSpecifierConstructors, singleElementSelectors),
    multipleElementsSpecifierAttributes: Object.assign({}, untargetedSpecifierConstructors, multipleElementSelectors),
};

const untargetedConRootTables = {
    rootSpecifierDescriptor: kConRootDesc,
    rootSpecifierAttributes: untargetedSpecifierConstructors, // con
    insertionSpecifierAttributes: {},
    propertySpecifierAttributes: untargetedSpecifierConstructors,
    singleElementSpecifierAttributes: Object.assign({}, untargetedSpecifierConstructors, singleElementSelectors),
    multipleElementsSpecifierAttributes: Object.assign({}, untargetedSpecifierConstructors, multipleElementSelectors),
};

const untargetedItsRootTables = {
    rootSpecifierDescriptor: kItsRootDesc,
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
	function specifierProxy() {} // TO DO: confirm proxied object needs to be callable to support 'apply' trap
    specifierProxy.appData = appData;
    
    if (!(specifierRecord instanceof Object) || specifierRecord.constructor.name !== 'Object') {
    	throw new Error(`newSpecifier: expected specifierRecord, got ${typeof specifierRecord}: ${util.inspect(specifierRecord)}`);
    }
    //console.log(`newSpecifier: expected specifierRecord, got ${typeof specifierRecord}: ${util.inspect(specifierRecord)}`);
    
    specifierProxy.specifierRecord = specifierRecord;
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
                return function(aeBuffer, appData) { // note: AppData instance that passes itself here is already targeted
                    return specifierRecord.pack(aeBuffer, appData, specifierRecord);
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
            if (!aesupport.isString(name)) { return undefined; }
            // is it a selector?
            const selectorFunc = specifierRecord.selectors[name];
            if (selectorFunc) { // is it a standard selector ()
                return selectorFunc(appData, specifierRecord, name);
            }
            for (let key of [__getProperty,
							 __getElements,
							 __getCommand,
							 __getZeroIndexSelector,
							 __getUserProperty,
							 __getUnknownName]) { // important: __unknownName__ must be tested for last as it's the catchall for untargeted specifiers' names
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


function newCustomRootSpecifierRecord(rootValue) {
    return {from: null,
            want: null,
            form: aesupport.kSpecifierRoot, // end of specifier chain; cachedDesc = app/con/its root
            seld: rootValue,
            cachedDesc: null,
            selectors: targetedAppRootTables.rootSpecifierAttributes,
            call: doNotCall,
            pack: function(aeBuffer, appData, specifierRecord) {
            	appData._writeDescriptor(aeBuffer, specifierRecord.seld);
            }};
}


function newRootSpecifierRecord(appData) { // app/con/its
    return {from: null,
            want: appData.rootSpecifierDescriptor.type, // store descriptorType in 'want'...
            form: aesupport.kSpecifierRoot, // end of specifier chain; cachedDesc = app/con/its root
            seld: null,
            cachedDesc: appData.rootSpecifierDescriptor,
            selectors: appData.rootSpecifierAttributes,
            call: doNotCall,
            pack: function(aeBuffer, appData, specifierRecord) {
            	aeBuffer.writeUInt32BE(specifierRecord.want); // ...and pack descriptorType
				aeBuffer.writeUInt32BE(0);
            }};
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
    isSpecifier,
    
    Range, // used in unpack
    newRootSpecifier,
    
    packCachedDesc, // also used in AppData to minimize unpack+repack
    
    // formatter needs the following to compensate for lack of real notEqualTo and isIn operators
    packNotEqualsTest,
    packIsInTest,
};

