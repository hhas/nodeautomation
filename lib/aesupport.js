#!/usr/bin/env node

'use strict';

// aesupport

const util = require('util');

const objc = require('objc');

const kae = require('./kae');


const __packSelf = Symbol('__packSelf'); // method key for packing any nodeautomation object (reference, symbol, etc)
const __keywordName = Symbol('__keywordName');
const __rawDescriptor = Symbol('__rawDescriptor');
const __specifierRecord = Symbol('__specifierRecord');
const __appData = Symbol('__appData');
const __getProperty = Symbol('__getProperty');
const __getElements = Symbol('__getElements');
const __getCommand = Symbol('__getCommand');
const __getZeroIndexSelector = Symbol('__getZeroIndexSelector');
const __getUserProperty = Symbol('__getUserProperty');
const __getUnknownName = Symbol('__getUnknownName');

/****************************************************************************************/
// utility functions

function isString(object) { return (typeof object === 'string' || object instanceof String); }

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
    return objc.NSAppleEventDescriptor.alloc().initWithDescriptorType_data_(descType, data);
}

function newAbsoluteOrdinalDescriptor(code) { // kludgy    
    const b = Buffer.alloc(4);
    b.writeUInt32LE(code); // caution: JS Buffer objects don't appear to provide methods for writing with native endianness, so currently hardcoded as LE (i386/x86_64), though chances of macOS going back to BE architecture in this library's lifetime are minimal anyway
    return objc.NSAppleEventDescriptor.descriptorWithDescriptorType_bytes_length_(kae.typeAbsoluteOrdinal, b, Buffer.byteLength(b));
}


function isDescriptor(value) {
    try {
        return (objc.isInstance(value) && value.isKindOfClass_(objc.NSAppleEventDescriptor));
    } catch(e) {
        return false;
    }
}


function parseFourCharCode(code) { // accept '#CCCC', '0xXXXXXXXX', Number; return UInt32
    if (isString(code) && code.match(/^#[\x20-\x7E]{4}$/) !== null) {
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
            return '0x' + (`00000000${parseInt(num, 16)}`.slice(-8));
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
        return objc.NSURL.fileURLWithPath_(objc.ns(name));
    } else { // if only app's name is given, locate app bundle via Launch Services (.app suffix is optional)
        const workspace = objc.NSWorkspace.sharedWorkspace();
        var path = workspace.fullPathForApplication_(objc.ns(name));
        if (!path && !name.toLowerCase().endsWith('.app')) {
            path = workspace.fullPathForApplication_(`${name}.app`);
        }
        return (path ? objc.NSURL.fileURLWithPath_(path) : null);
    }
}


/****************************************************************************************/
// AEDescs used in constructing object specifiers

function newUInt32Descriptor(num) { // kludgy
    return objc.NSAppleEventDescriptor.descriptorWithDouble_(UInt32(num)).coerceToDescriptorType_(kae.typeUInt32);
}

function newTypeDescriptor(code) {
    return objc.NSAppleEventDescriptor.descriptorWithTypeCode_(code);
}

function newEnumDescriptor(code) {
    return objc.NSAppleEventDescriptor.descriptorWithEnumCode_(code);
}

// AEM doesn't support these query forms directly, so define custom codes here and translate to supported forms on pack
const kAENotEquals = 1;
const kAEIsIn = 2;


/****************************************************************************************/
// additional types

// keyword constructor, e.g. k.UnicodeText, k.fromTypeCode(0x75747874)

class Keyword {
    
    // constructors
    static fromTypeCode(code) { return new Keyword(null, newTypeDescriptor(parseFourCharCode(code))); }
    static fromEnumCode(code) { return new Keyword(null, newEnumDescriptor(parseFourCharCode(code))); }

	constructor (name, desc = null) { // either name or desc must be given (if desc is given, name is null)
		this[__packSelf] = function(appData) {
			return desc || appData.typeDescriptorByName(name);
		};
		this[__keywordName] = name;
		this[__rawDescriptor] = desc; // only used when constructing with raw four-char code
    }
    
    [Symbol.toString]() {
        if (this[__keywordName]) {
            return `k.${this[__keywordName]}`;
        } else if (this[__rawDescriptor].descriptorType() === kae.typeEnumerated) {
            return `k.fromEnumCode(${formatFourCharString(this[__rawDescriptor].enumCodeValue())})`;
        } else {
            return `k.fromTypeCode(${formatFourCharString(this[__rawDescriptor].typeCodeValue())})`;
        }
    }
    
    [util.inspect.custom]() { return this[Symbol.toString](); }
    
    isEqual(value) {
        if (!(value instanceof Keyword)) { return false; }
        if (this[__keywordName] && this[__keywordName] === value[__keywordName]) { return true; }
        if (!(this[__rawDescriptor] && value[__rawDescriptor])) { return false; }
        if (this[__rawDescriptor].descriptorType() !== value[__rawDescriptor].descriptorType()) { return false; }
        return this[__rawDescriptor].data().isEqualToData(value[__rawDescriptor].data());
    }
    
    static isKeyword(value) { return value instanceof Keyword; }
}

// construct keyword using raw four-char code string/UInt32; these are re-exported by `k` proxy


// file system identifiers


class File {
	#_desc;
	
	static fromHFSPath(hfsPath) {
		if (!isString(hfsPath)) {
			throw new TypeError(`Invalid path argument for File.fromHFSPath constructor: ${util.inspect(hfsPath)}`);
		}
		const desc = objc.NSAppleEventDescriptor
						.descriptorWithString_(objc.ns(hfsPath))
						.coerceToDescriptorType_(kae.typeFileURL);
		if (!desc) {
			throw new TypeError(`Invalid path argument for File.fromHFSPath(...) constructor: ${util.inspect(hfsPath)}`);
		}
		return new File(objc.js(desc.fileURLValue()));
	}
	
	constructor(path) {
		if (this === undefined) { throw new TypeError("Missing 'new' for 'File' constructor."); }
		if (!(isString(path) && path.startsWith('/'))) {
			throw new TypeError(`Bad argument for 'File' constructor (expected POSIX path string): ${util.inspect(path)}`);
		}
		this._path = path;
		this.#_desc = objc.NSAppleEventDescriptor.descriptorWithFileURL_(objc.NSURL.fileURLWithPath_(objc.ns(path)));
    }
    
    [__packSelf](appData) { 
    return this.#_desc; 
    
    }
    
    // TO DO: find out which of these we need to implement
    
//    toString() { return this._path; }
//    [Symbol.valueOf]() { return this._path; }

    [Symbol.toPrimitive](hint) { return hint === 'number' ? Number.NaN : this._path; }

    [Symbol.toString]() { return this._path; }
    
    [util.inspect.custom]() { return `(new File(${util.inspect(path)}))`; };
    
    isEqual(value) { return value instanceof File && this._path === value._path; }
    
    get aliasDescriptor() { // for compatibility with older apps that won't accept a typeFileURL descriptor
    	return this.#_desc.coerceToDescriptorType_(kae.typeAlias);
    }
    
    toHFSPath() { // -> String
        const desc = objc.NSAppleEventDescriptor.descriptorWithFileURL_(objc.NSURL.fileURLWithPath_(this_path));
        return desc.coerceToDescriptorType_(kae.typeUnicodeText).stringValue(); // this shouldn't fail, 
    }

	static isFile(value) { return value instanceof File; }
}



/****************************************************************************************/
// EXPORTS

module.exports = {
	
	isString,
	
	__packSelf,
	__keywordName,
	__rawDescriptor,
	__specifierRecord,
	__appData,
    __getProperty,
    __getElements,
    __getCommand,
    __getZeroIndexSelector,
    __getUserProperty,
    __getUnknownName,
    
    // custom types
    Keyword,
    File,
    
    // cast and bounds-check numbers
    isSInt32,
    SInt32,
    UInt32,
    
    // convert four-char code strings (e.g. '#docu') to/from OSType, with bounds checking (uint32s are also accepted)
    parseFourCharCode:          parseFourCharCode,
    formatFourCharCode:         formatFourCharCode,
    formatFourCharString:       formatFourCharString,
    
    // convert JS's ELEMENTS[...] and ELEMENTS.slice(...) indexes (zero-indexed) to AE element indexes (one-indexed)
    convertZeroToOneIndex:      convertZeroToOneIndex,
    
    fileURLForLocalApplication: fileURLForLocalApplication,
    
    // convenience constructors for NSAppleEventDescriptors
    newDescriptor,
    newUInt32Descriptor,
    newTypeDescriptor,
    newEnumDescriptor,
    isDescriptor,
    
    // AEDescs used to terminate object specifier record chains
    kAppRootDesc:               objc.NSAppleEventDescriptor.nullDescriptor(),
    kConRootDesc:               newDescriptor(kae.typeCurrentContainer, null),
    kItsRootDesc:               newDescriptor(kae.typeObjectBeingExamined, null),
    
    // no-value flags used in AppData.sendAppleEvent() and aeformatter.formatSpecifier()
    kNoParameter:               Symbol('kNoParameter'),
    kSpecifierRoot:             Symbol('kSpecifierRoot'),
    
    /****************************************************************************************/
    // AEDescs used in constructing object specifiers
    
    // selector forms
    typePropertyDesc:         newTypeDescriptor(kae.typeProperty),
    formPropertyDesc:         newEnumDescriptor(kae.formPropertyID),       // specifier.NAME/specifier.property(CODE)
    formUserPropertyDesc:     newEnumDescriptor(kae.formUserPropertyID),   // specifier.$NAME
    formAbsolutePositionDesc: newEnumDescriptor(kae.formAbsolutePosition), // specifier.at(IDX)/first/middle/last/any
    formNameDesc:             newEnumDescriptor(kae.formName),             // specifier.named(NAME)
    formUniqueIDDesc:         newEnumDescriptor(kae.formUniqueID),         // specifier.ID(UID)
    formRelativePositionDesc: newEnumDescriptor(kae.formRelativePosition), // specifier.before/after(SYMBOL)
    formRangeDesc:            newEnumDescriptor(kae.formRange),            // specifier.thru(FROM,TO)
    formTestDesc:             newEnumDescriptor(kae.formTest),             // specifier.where(TEST)

    // absolute positions
    kAEFirstDesc:             newAbsoluteOrdinalDescriptor(kae.kAEFirst),
    kAEMiddleDesc:            newAbsoluteOrdinalDescriptor(kae.kAEMiddle),
    kAELastDesc:              newAbsoluteOrdinalDescriptor(kae.kAELast),
    kAEAnyDesc:               newAbsoluteOrdinalDescriptor(kae.kAEAny),
    kAEAllDesc:               newAbsoluteOrdinalDescriptor(kae.kAEAll),

    // relative positions
    kAEPreviousDesc:          newEnumDescriptor(kae.kAEPrevious),
    kAENextDesc:              newEnumDescriptor(kae.kAENext),
    
    /****************************************************************************************/
    // AEDescs used in constructing insertion locations
    
    kAEBeginningDesc:         newEnumDescriptor(kae.kAEBeginning),
    kAEEndDesc:               newEnumDescriptor(kae.kAEEnd),
    kAEBeforeDesc:            newEnumDescriptor(kae.kAEBefore),
    kAEAfterDesc:             newEnumDescriptor(kae.kAEAfter),

    /****************************************************************************************/
    // AEDescs used in constructing test clauses

    // comparison tests
    kAELessThanDesc:          newEnumDescriptor(kae.kAELessThan),
    kAELessThanEqualsDesc:    newEnumDescriptor(kae.kAELessThanEquals),
    kAEEqualsDesc:            newEnumDescriptor(kae.kAEEquals),
    kAEGreaterThanDesc:       newEnumDescriptor(kae.kAEGreaterThan),
    kAEGreaterThanEqualsDesc: newEnumDescriptor(kae.kAEGreaterThanEquals),
    // containment tests
    kAEBeginsWithDesc:        newEnumDescriptor(kae.kAEBeginsWith),
    kAEEndsWithDesc:          newEnumDescriptor(kae.kAEEndsWith),
    kAEContainsDesc:          newEnumDescriptor(kae.kAEContains),
    // logic tests
    kAEANDDesc:               newEnumDescriptor(kae.kAEAND),
    kAEORDesc:                newEnumDescriptor(kae.kAEOR),
    kAENOTDesc:               newEnumDescriptor(kae.kAENOT),
};

