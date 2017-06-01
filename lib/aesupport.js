#!/usr/bin/env node

'use strict';

// aesupport

const objc = require('./objc');

// TO DO: how best to implement 'equalTo' comparisons on Keyword and File objects?


/****************************************************************************************/
// utility functions

const SINT32_MIN = Math.pow(-2, 31);
const SINT32_MAX = Math.pow(2, 31) - 1;
const UINT32_MAX = Math.pow(2, 32) - 1;


function convertZeroToOneIndex(num) {
    const n = Number(num);
    if (n % 1 !== 0 || n < SINT32_MIN || n >= SINT32_MAX) { throw new TypeError(`Not a 32-bit integer: "${num}"`); }
    return n < 0 ? n : n + 1;
}

function isSInt32(num) {
    const n = Number(num);
    return (n % 1 === 0 && n >= SINT32_MIN && n <= SINT32_MAX);
}

function SInt32(num) {
    const n = Number(num);
    if (n % 1 !== 0 || n < SINT32_MIN || n > SINT32_MAX) { throw new TypeError(`Not a 32-bit integer: "${num}"`); }
    return n;
}

function UInt32(num) {
    const n = Number(num);
    if (n % 1 !== 0 || n < 0 || n > UINT32_MAX) { throw new TypeError(`Not a 32-bit unsigned integer: "${num}"`); }
    return n;
}

function newDescriptor(descType, data) {
    return objc.NSAppleEventDescriptor('alloc')('initWithDescriptorType', descType, 'data', data);
}

function newAbsoluteOrdinalDescriptor(code) { // kludgy    
    const b = Buffer(4);
    b.writeUInt32LE(code); // TO DO: Buffer doesn't provide methods for writing with native endianness, so for now hardcode as LE (i386/x86_64)
    return objc.NSAppleEventDescriptor('descriptorWithDescriptorType', objc.typeAbsoluteOrdinal, 
                                                                    'bytes', b, 'length', Buffer.byteLength(b));
}


function isDescriptor(value) {
    try {
        return (typeof value === 'function' && value.getClass !== undefined // possible ObjC instance // TO DO: check NodObjC API for dedicated type checking functions
                && value.getClass()('isSubclassOfClass', objc.NSAppleEventDescriptor('class')));
    } catch(e) {
        return false;
    }
}


function parseFourCharCode(code) { // accept '#CCCC', '0xXXXXXXXX', Number; return UInt32
    if (typeof code === 'string' && code.match(/^#[\x20-\x7E]{4}$/) !== null) {
        return (code.charCodeAt(1) << 24) | (code.charCodeAt(2) << 16) | (code.charCodeAt(3) << 8) | code.charCodeAt(4);
    } else {
        return UInt32(code); // accept 32-bit uint; hex strings, e.g. "0x1234ABCD" are also acceptable (e.g. object key)
    }
}

function formatFourCharCode(num) { // format UInt32 as four-char code; note that string results are not quoted literals
    num = Number(num);
    if (num % 1 !== 0 || num < 0 || num > UINT32_MAX) { throw new TypeError(`Not an OSType: "${num}"`); }
    var result = '#'; // printable ASCII format is '#CCCC' (preferred); non-printable is '0xXXXXXXXX'
    for (var rs of [24, 16, 8, 0]) {
        const n = (num >> rs) % 256;
        if (n >= 0x20 && n < 0x7f) { // build printable ASCII string representation
            result += String.fromCharCode(n);
        } else { // discard and return hexadecimal representation
            return '0x' + (('00000000'+num.toString(16)).slice(-8));
        }
    }
    return result;
}


/****************************************************************************************/
// AEDescs used in constructing object specifiers

function newUInt32Descriptor(num) { // kludgy
    return objc.NSAppleEventDescriptor('descriptorWithDouble', UInt32(num))('coerceToDescriptorType', objc.typeUInt32);
}

function newTypeDescriptor(code) {
    return objc.NSAppleEventDescriptor('descriptorWithTypeCode', code);
}

function newEnumDescriptor(code) {
    return objc.NSAppleEventDescriptor('descriptorWithEnumCode', code);
}

// AEM doesn't support these query forms directly, so define custom codes here and translate to supported forms on pack
const kAENotEquals = 1
const kAEIsIn = 2


/****************************************************************************************/
// additional types

// keyword constructor, e.g. k.UnicodeText, k[0x75747874]

// TO DO: raw four-char codes currently always construct typeType (which annoyingly won't coerce to typeEnumerated); how to specify other descriptor types? (e.g. 't'/'e'['p'/'k'] prefix/suffix? or 'fromEnumeratorCode', 'fromPropertyCode', etc; in which case, drop the k[CODE] form and use those methods only; this will leave params as only place where names and fccs are interchangeable, which can address params vs attrs separately)

function Keyword(name) { //
    const isFourCharCode = name.match(/^[0-9]+|0[xX][0-9a-zA-Z]+|#[\x20-\x7E]{4}$/) !== null;
    this.__nodeautomation_pack__ = function(appData) {
        return isFourCharCode ? newTypeDescriptor(parseFourCharCode(name)) : appData.typeDescriptorByName(name);
    }
    this.__nodeautomation_keywordName__ = name;
    this.toString = function() {
        return isFourCharCode ? `k['${formatFourCharCode(name)}']` : `k.${name}`;
    }
    this.valueOf = this.toString;
    this.inspect = this.toString;
}

function isKeyword(value) {
    return value instanceof Keyword;
}


// file system identifiers

// TO DO: toString/valueOf/inspect

function File(path) {
    if (typeof path !== 'string' || path[0] !== '/') {
        throw new TypeError(`Invalid path argument for File constructor: ${formatValue(path)}`);
    }
    this._path = path;
    this._desc = objc.NSAppleEventDescriptor('descriptorWithFileURL', objc.NSURL('fileURLWithPath', objc(path)));
    
    this.__nodeautomation_pack__ = function(appData) {
        return this._desc;
    };
    
    this.__nodeautomation_descriptorType__ = formatFourCharCode(this._desc('descriptorType'));
    
    this.toPath = function() {
        return this._path;
    }
    
    this.toHFSPath = function() { // -> String
        const desc = NSAppleEventDescriptor('descriptorWithFileURL', objc.NSURL('fileURLWithPath', this_path));
        return desc('coerceToDescriptorType', objc.typeUnicodeText)('stringValue'); // this shouldn't fail, 
    };
}

File.fromHFSPath = function(hfsPath) {
    if (typeof hfsPath !== 'string') {
        throw new TypeError(`Invalid path argument for File.fromHFSPath constructor: ${formatValue(hfsPath)}`);
    }
    const desc = (objc.NSAppleEventDescriptor('descriptorWithString', objc(hfsPath))
                                             ('coerceToDescriptorType', objc.typeFileURL));
    if (desc === null) {
        throw new TypeError(`Invalid path argument for File.fromHFSPath(...) constructor: ${formatValue(hfsPath)}`);
    }
    return new File(desc('fileURLValue').toString());
};

File.isFile = function(value) {
    return value instanceof File;
}



/****************************************************************************************/
// EXPORTS

module.exports = {
    
    // custom types
    Keyword: Keyword,
    isKeyword: isKeyword,
    File: File,
    
    // cast and bounds-check numbers
    isSInt32: isSInt32,
    SInt32: SInt32,
    UInt32: UInt32,
    
    // convert four-char code strings (e.g. '#docu') to/from OSType, with bounds checking (uint32s are also accepted)
    parseFourCharCode:                    parseFourCharCode,
    formatFourCharCode:                    formatFourCharCode,
    
    // convert JS's ELEMENTS[...] and ELEMENTS.slice(...) indexes (zero-indexed) to AE element indexes (one-indexed)
    convertZeroToOneIndex:                convertZeroToOneIndex,
    
    // convenience constructors for NSAppleEventDescriptors
    newDescriptor:                        newDescriptor,
    newUInt32Descriptor:                newUInt32Descriptor,
    newTypeDescriptor:                    newTypeDescriptor,
    newEnumDescriptor:                    newEnumDescriptor,
    isDescriptor:                        isDescriptor,
    
    // AEDescs used to terminate object specifier record chains
    kAppRootDesc: objc.NSAppleEventDescriptor('nullDescriptor'),
    kConRootDesc: newDescriptor(objc.typeCurrentContainer, null),
    kItsRootDesc: newDescriptor(objc.typeObjectBeingExamined, null),
    
    // no-value flags used in AppData.sendAppleEvent() and aeformatter.formatSpecifier()
    kNoParameter:   Symbol('kNoParameter'),
    kSpecifierRoot: Symbol('kSpecifierRoot'),
    
    /****************************************************************************************/
    // AEDescs used in constructing object specifiers
    
    // selector forms
    typePropertyDesc:            newTypeDescriptor(objc.typeProperty),
    formPropertyDesc:              newEnumDescriptor(objc.formPropertyID),       // specifier.NAME/specifier.property(CODE)
    formUserPropertyDesc:          newEnumDescriptor(objc.formUserPropertyID),   // specifier.$NAME
    formAbsolutePositionDesc:    newEnumDescriptor(objc.formAbsolutePosition), // specifier.at(IDX)/first/middle/last/any
    formNameDesc:                  newEnumDescriptor(objc.formName),             // specifier.named(NAME)
    formUniqueIDDesc:              newEnumDescriptor(objc.formUniqueID),         // specifier.ID(UID)
    formRelativePositionDesc:    newEnumDescriptor(objc.formRelativePosition), // specifier.before/after(SYMBOL)
    formRangeDesc:                 newEnumDescriptor(objc.formRange),            // specifier.thru(FROM,TO)
    formTestDesc:                  newEnumDescriptor(objc.formTest),             // specifier.where(TEST)

    // absolute positions
    kAEFirstDesc:                  newAbsoluteOrdinalDescriptor(objc.kAEFirst),
    kAEMiddleDesc:                 newAbsoluteOrdinalDescriptor(objc.kAEMiddle),
    kAELastDesc:                   newAbsoluteOrdinalDescriptor(objc.kAELast),
    kAEAnyDesc:                    newAbsoluteOrdinalDescriptor(objc.kAEAny),
    kAEAllDesc:                    newAbsoluteOrdinalDescriptor(objc.kAEAll),

    // relative positions
    kAEPreviousDesc:               newEnumDescriptor(objc.kAEPrevious),
    kAENextDesc:                   newEnumDescriptor(objc.kAENext),
    
    /****************************************************************************************/
    // AEDescs used in constructing insertion locations
    
    kAEBeginningDesc:              newEnumDescriptor(objc.kAEBeginning),
    kAEEndDesc:                    newEnumDescriptor(objc.kAEEnd),
    kAEBeforeDesc:                 newEnumDescriptor(objc.kAEBefore),
    kAEAfterDesc:                  newEnumDescriptor(objc.kAEAfter),

    /****************************************************************************************/
    // AEDescs used in constructing test clauses

    // comparison tests
    kAELessThanDesc:               newEnumDescriptor(objc.kAELessThan),
    kAELessThanEqualsDesc:         newEnumDescriptor(objc.kAELessThanEquals),
    kAEEqualsDesc:                 newEnumDescriptor(objc.kAEEquals),
    kAEGreaterThanDesc:            newEnumDescriptor(objc.kAEGreaterThan),
    kAEGreaterThanEqualsDesc:      newEnumDescriptor(objc.kAEGreaterThanEquals),
    // containment tests
    kAEBeginsWithDesc:             newEnumDescriptor(objc.kAEBeginsWith),
    kAEEndsWithDesc:               newEnumDescriptor(objc.kAEEndsWith),
    kAEContainsDesc:               newEnumDescriptor(objc.kAEContains),
    // logic tests
    kAEANDDesc:                    newEnumDescriptor(objc.kAEAND),
    kAEORDesc:                     newEnumDescriptor(objc.kAEOR),
    kAENOTDesc:                    newEnumDescriptor(objc.kAENOT),
};

