#!/usr/bin/env node

'use strict';

// aesupport

const util = require('util');

const objc = require('./objc');


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
    b.writeUInt32LE(code); // caution: JS Buffer objects don't appear to provide methods for writing with native endianness, so currently hardcoded as LE (i386/x86_64), though chances of macOS going back to BE architecture in this library's lifetime are minimal anyway
    return objc.NSAppleEventDescriptor('descriptorWithDescriptorType', objc.typeAbsoluteOrdinal, 
                                                                       'bytes', b, 'length', Buffer.byteLength(b));
}


function isDescriptor(value) {
    try {
        return (typeof value === 'function' && value.getClass !== undefined // possible ObjC instance
                && value('isKindOfClass', objc.NSAppleEventDescriptor));
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

function formatFourCharCode(num) { // format UInt32 as four-char code (note: to get JS literal representation, use formatFourCharString)
    num = Number(num);
    if (num % 1 !== 0 || num < 0 || num > UINT32_MAX) { throw new TypeError(`Not an OSType: "${num}"`); }
    var result = '#'; // printable ASCII format is '#CCCC' (preferred); non-printable is '0xXXXXXXXX'
    for (var rs of [24, 16, 8, 0]) {
        const n = (num >> rs) % 256;
        if (n >= 0x20 && n < 0x7f && n !== 34 && n !== 92) { // build printable ASCII string representation (backslash and double quote chars are also excluded to simplify formatting the result as a string literal)
            result += String.fromCharCode(n);
        } else { // discard and return hexadecimal representation
            return '0x' + (('00000000'+num.toString(16)).slice(-8));
        }
    }
    return result;
}

function formatFourCharString(num) { // format UInt32 as a JS literal (hex number or double-quoted string)
    var fcc = formatFourCharCode(num);
    return fcc.startsWith('#') ? `"${fcc}"` : fcc;
}


function fileURLForLocalApplication(name) { // String -> NSURL/null
    // note: relative paths are not supported; `name` must be absolute path or file name only
    if (name.startsWith("/")) { // absolute path to app bundle (note: full path must include .app suffix)
        return objc.NSURL('fileURLWithPath', objc(name));
    } else { // if only app's name is given, locate app bundle via Launch Services (.app suffix is optional)
        const workspace = objc.NSWorkspace('sharedWorkspace');
        var path = workspace('fullPathForApplication', objc(name));
        if (!path && !name.toLowerCase().endsWith('.app')) {
            path = workspace('fullPathForApplication', `${name}.app`);
        }
        return (path ? objc.NSURL('fileURLWithPath', path) : null);
    }
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
const kAENotEquals = 1;
const kAEIsIn = 2;


/****************************************************************************************/
// additional types

// keyword constructor, e.g. k.UnicodeText, k.fromTypeCode(0x75747874)

function Keyword(name, desc = null) { // either name or desc must be given (if desc is given, name is null)
    this.__nodeautomation_pack__ = function(appData) {
        return desc || appData.typeDescriptorByName(name);
    };
    this.__nodeautomation_keywordName__ = name;
    this.__nodeautomation_rawDescriptor__ = desc; // only used when constructing with raw four-char code
    this.toString = function() {
        if (name) {
            return `k.${name}`;
        } else if (desc('descriptorType') === objc.typeEnumerated) {
            return `k.fromEnumCode(${formatFourCharString(desc('enumCodeValue'))})`;
        } else {
            return `k.fromTypeCode(${formatFourCharString(desc('typeCodeValue'))})`;
        }
    };
    this.inspect = this.toString;
    
    this.isEqual = function(value) {
        if (!(value instanceof Keyword)) { return false; }
        if (name && name === value.__nodeautomation_keywordName__) { return true; }
        if (!(desc && value.__nodeautomation_rawDescriptor__)) { return false; }
        if (desc('descriptorType') !== value.__nodeautomation_rawDescriptor__('descriptorType')) { return false; }
        return (desc('data')('isEqualToData', value.__nodeautomation_rawDescriptor__('data')));
    };
}

// construct keyword using raw four-char code string/UInt32; these are re-exported by `k` proxy
Keyword.fromTypeCode = function(code) { return new Keyword(null, newTypeDescriptor(parseFourCharCode(code))); };
Keyword.fromEnumCode = function(code) { return new Keyword(null, newEnumDescriptor(parseFourCharCode(code))); };

Keyword.isKeyword = function(value) { return value instanceof Keyword; };


// file system identifiers


function File(path) {
    if (this === undefined) { throw new TypeError("Missing 'new' for 'File' constructor."); }
    if (!(typeof path === 'string' && path.startsWith('/'))) {
        throw new TypeError(`Bad argument for 'File' constructor (expected POSIX path string): ${util.inspect(path)}`);
    }
    this._path = path;
    this._desc = objc.NSAppleEventDescriptor('descriptorWithFileURL', objc.NSURL('fileURLWithPath', objc(path)));
    
    this.__nodeautomation_pack__ = function(appData) { return this._desc; };
    
    this.toString = function() { return this._path; };
    this.valueOf = this[Symbol.toPrimitive] = this.toString;
    
    this.inspect = function() { return `new File(${util.inspect(path)})`; };
    
    this.isEqual = function(value) { return value instanceof File && this._path === value._path; };
    
    this.toHFSPath = function() { // -> String
        const desc = NSAppleEventDescriptor('descriptorWithFileURL', objc.NSURL('fileURLWithPath', this_path));
        return desc('coerceToDescriptorType', objc.typeUnicodeText)('stringValue'); // this shouldn't fail, 
    };
}

File.fromHFSPath = function(hfsPath) {
    if (typeof hfsPath !== 'string') {
        throw new TypeError(`Invalid path argument for File.fromHFSPath constructor: ${util.inspect(hfsPath)}`);
    }
    const desc = (objc.NSAppleEventDescriptor('descriptorWithString', objc(hfsPath))
                                             ('coerceToDescriptorType', objc.typeFileURL));
    if (!desc) {
        throw new TypeError(`Invalid path argument for File.fromHFSPath(...) constructor: ${util.inspect(hfsPath)}`);
    }
    return new File(desc('fileURLValue').toString());
};

File.isFile = function(value) {
    return value instanceof File;
};



/****************************************************************************************/
// EXPORTS

module.exports = {
    
    // custom types
    Keyword:   Keyword,
    File:      File,
    
    // cast and bounds-check numbers
    isSInt32:  isSInt32,
    SInt32:    SInt32,
    UInt32:    UInt32,
    
    // convert four-char code strings (e.g. '#docu') to/from OSType, with bounds checking (uint32s are also accepted)
    parseFourCharCode:          parseFourCharCode,
    formatFourCharCode:         formatFourCharCode,
    formatFourCharString:       formatFourCharString,
    
    // convert JS's ELEMENTS[...] and ELEMENTS.slice(...) indexes (zero-indexed) to AE element indexes (one-indexed)
    convertZeroToOneIndex:      convertZeroToOneIndex,
    
    fileURLForLocalApplication: fileURLForLocalApplication,
    
    // convenience constructors for NSAppleEventDescriptors
    newDescriptor:              newDescriptor,
    newUInt32Descriptor:        newUInt32Descriptor,
    newTypeDescriptor:          newTypeDescriptor,
    newEnumDescriptor:          newEnumDescriptor,
    isDescriptor:               isDescriptor,
    
    // AEDescs used to terminate object specifier record chains
    kAppRootDesc:               objc.NSAppleEventDescriptor('nullDescriptor'),
    kConRootDesc:               newDescriptor(objc.typeCurrentContainer, null),
    kItsRootDesc:               newDescriptor(objc.typeObjectBeingExamined, null),
    
    // no-value flags used in AppData.sendAppleEvent() and aeformatter.formatSpecifier()
    kNoParameter:               Symbol('kNoParameter'),
    kSpecifierRoot:             Symbol('kSpecifierRoot'),
    
    /****************************************************************************************/
    // AEDescs used in constructing object specifiers
    
    // selector forms
    typePropertyDesc:         newTypeDescriptor(objc.typeProperty),
    formPropertyDesc:         newEnumDescriptor(objc.formPropertyID),       // specifier.NAME/specifier.property(CODE)
    formUserPropertyDesc:     newEnumDescriptor(objc.formUserPropertyID),   // specifier.$NAME
    formAbsolutePositionDesc: newEnumDescriptor(objc.formAbsolutePosition), // specifier.at(IDX)/first/middle/last/any
    formNameDesc:             newEnumDescriptor(objc.formName),             // specifier.named(NAME)
    formUniqueIDDesc:         newEnumDescriptor(objc.formUniqueID),         // specifier.ID(UID)
    formRelativePositionDesc: newEnumDescriptor(objc.formRelativePosition), // specifier.before/after(SYMBOL)
    formRangeDesc:            newEnumDescriptor(objc.formRange),            // specifier.thru(FROM,TO)
    formTestDesc:             newEnumDescriptor(objc.formTest),             // specifier.where(TEST)

    // absolute positions
    kAEFirstDesc:             newAbsoluteOrdinalDescriptor(objc.kAEFirst),
    kAEMiddleDesc:            newAbsoluteOrdinalDescriptor(objc.kAEMiddle),
    kAELastDesc:              newAbsoluteOrdinalDescriptor(objc.kAELast),
    kAEAnyDesc:               newAbsoluteOrdinalDescriptor(objc.kAEAny),
    kAEAllDesc:               newAbsoluteOrdinalDescriptor(objc.kAEAll),

    // relative positions
    kAEPreviousDesc:          newEnumDescriptor(objc.kAEPrevious),
    kAENextDesc:              newEnumDescriptor(objc.kAENext),
    
    /****************************************************************************************/
    // AEDescs used in constructing insertion locations
    
    kAEBeginningDesc:         newEnumDescriptor(objc.kAEBeginning),
    kAEEndDesc:               newEnumDescriptor(objc.kAEEnd),
    kAEBeforeDesc:            newEnumDescriptor(objc.kAEBefore),
    kAEAfterDesc:             newEnumDescriptor(objc.kAEAfter),

    /****************************************************************************************/
    // AEDescs used in constructing test clauses

    // comparison tests
    kAELessThanDesc:          newEnumDescriptor(objc.kAELessThan),
    kAELessThanEqualsDesc:    newEnumDescriptor(objc.kAELessThanEquals),
    kAEEqualsDesc:            newEnumDescriptor(objc.kAEEquals),
    kAEGreaterThanDesc:       newEnumDescriptor(objc.kAEGreaterThan),
    kAEGreaterThanEqualsDesc: newEnumDescriptor(objc.kAEGreaterThanEquals),
    // containment tests
    kAEBeginsWithDesc:        newEnumDescriptor(objc.kAEBeginsWith),
    kAEEndsWithDesc:          newEnumDescriptor(objc.kAEEndsWith),
    kAEContainsDesc:          newEnumDescriptor(objc.kAEContains),
    // logic tests
    kAEANDDesc:               newEnumDescriptor(objc.kAEAND),
    kAEORDesc:                newEnumDescriptor(objc.kAEOR),
    kAENOTDesc:               newEnumDescriptor(objc.kAENOT),
};

