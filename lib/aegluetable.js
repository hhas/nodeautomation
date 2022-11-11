// build keyword-code mapping tables from SDEF

'use strict';

// TO DO: [exported] glue tables currently store command parameters as unordered {name:code,...} object, but should use [{name,code},...] just in case ordering ever becomes significant

// TO DO: FIX: PS defines `RGBColor` as 'cRGv', but this isn't overriding built-in 'cRGB'; why?

// TO DO: FIX: table objects should either be `Object.create(null)` or `new Map()`, to ensure no properties can be inherited from Object prototype should other libraries mess with that

// TO DO: names should probably always start with lowercase letter, e.g. 'utf8Text' not 'UTF8Text', as linters treat leading cap as indicating class name so will complain about `k.UTF8Text`


const ffi = require('ffi-napi');
const ref = require('ref-napi');

const objc = require('objc');

const kDefaultTerminology = require('./aedefaultterminology');
const aesupport = require('./aesupport');
const aeerrors = require('./aeerrors');
const kae = require('./kae');

const {SDEFParser} = require('./sdefparser');

const kGlueVersion = "1.0";


/****************************************************************************************/
// reserved attribute/parameter names


const reservedNames = [ // see aeselectors
  'at', 'named', 'ID', 'previous', 'next', 'slice', 'thru', 'where',
  'first', 'middle', 'last', 'any', 'every', 'beginning', 'end', 'before', 'after',
  'lt', 'le', 'eq', 'ne', 'gt', 'ge', 'beginsWith', 'endsWith', 'contains', 'isIn', 'and', 'or', 'not',
  'customRoot', 'launch', 'isRunning', 'property', 'elements', 'sendAppleEvent', 'help',
  'asType', 'sendOptions', 'withTimeout', 'ignoring', // command attributes
  'toString', 'valueOf', 'constructor', 'isSpecifier', 'isKeyword',
  'fromTypeCode', 'fromEnumCode', // raw Keyword constructors
];


/****************************************************************************************/
// support functions


function toEightCharCode(eventClass, eventID) {
  return `${eventClass}/${eventID}`;
}

// get application terminology in SDEF format

/*
extern OSAError 
OSACopyScriptingDefinitionFromURL(
  CFURLRef     url,
  SInt32       modeFlags,
  CFDataRef *  sdef);
 */

const CFRef = ref.refType("void")
const CFRefPtr = ref.refType(CFRef)


const OpenScripting = new ffi.Library(null, {
  OSACopyScriptingDefinitionFromURL: ['int', ['pointer', 'int', CFRefPtr]],
  CFRelease: ['void', [CFRef]],
});

function getScriptingDefinition(url) { // NSURL -> NSData
  const sdefPtr = ref.alloc(CFRefPtr); // CFDataRef*
  // next up: objc doesn't provide CF support itself, nor any NS<->CF bridging support; fortunately, NSURL/CFURLRef is is already toll-free bridged, and we're only borrowing it here, not transferring its ownership to CF, so getting the NSURL's pointer (which is now void* thanks to ffi) is no different to performing a plain old C cast from NSURL* to CFURLRef when passing the former where the latter is expected; a little reckless, perhaps, but nothing that C lang hasn't gotten away with a quadrillion times before; sloppiness FTW)
  const err = OpenScripting.OSACopyScriptingDefinitionFromURL(url[objc.__internal__.keyObjCObject].ptr, 0, sdefPtr); // sdef arg returns CFData
  if (err !== 0) { // note: if -192 (resource not found), app is 'non-scriptable' so use default terms only
    throw new aeerrors.TerminologyError(`can't get SDEF from ${url}`, err);
  }
  const sdef = sdefPtr.deref();
  const result = objc.NSData.dataWithData_(objc.__internal__.wrapInstance(sdef));
  OpenScripting.CFRelease(sdef);
  return result;
}


// support functions used by SDEFParser

function toFourCharCode(string) { // String -> OSType
  const data = objc.ns(string).dataUsingEncoding_(30); // NSMacOSRomanStringEncoding = 30
  if (!data) {
    throw new aeerrors.TerminologyError(`invalid four-char code (bad encoding): "${string}"`);
  }
  if (data.length() !== 4) {
    throw new aeerrors.TerminologyError(`invalid four-char code (wrong length): "${string}"`);
  }
  const tmp = Buffer.alloc(4);
  data.getBytes_length_(tmp, 4);
  return tmp.readInt32BE();
}

const _convertedNameCache = {}; // trade memory for speed when converting keywords that appear repeatedly

function convertNameToIdentifier(name, isParameter) {
  name = objc.js(name);
  let identifier = _convertedNameCache[name];
  if (identifier === undefined) {
    identifier = name.trim().replace(/\s+./g, function(s) { return s.substr(-1).toUpperCase(); });
    if (!isParameter && reservedNames.includes(identifier)) { identifier = escapeIdentifier(identifier); }
    _convertedNameCache[name] = identifier;
  }
  return identifier;
}

function escapeIdentifier(identifier) {
  return `${identifier}_`;
}


const _inspectOptions = {maxArrayLength:null, depth:null};


/****************************************************************************************/
// GlueTable; this constructs the terminology lookup tables used by AppData


function GlueTable() {
  
  this.typesByName              = {}; // {String:{type,code} // Symbol members (properties, types, and enums)
  this.typesByCode              = {}; // {OSType:String}
  
  this.elementsByName           = {}; // {String:KeywordTerm}
  this.elementsByCode           = {}; // {OSType:String}
  
  this.propertiesByName         = {}; // {String:KeywordTerm} // e.g. AERecord keys
  this.propertiesByCode         = {}; // {OSType:String}
  
  this.commandsByName           = {}; // {String:CommandTerm}
  
  this._defaultTypesByName      = {};
  this._defaultPropertiesByName = {};
  this._defaultElementsByName   = {};
  this._defaultCommandsByName   = {};
  
  //
  
  this._addSymbolKeywords = function(keywords, type) {
    // keywords : [KeywordTerm]
    // type : typeType | typeEnumerated -- note: any property names are also packed as typeType
    const len = keywords.length;
    for (let i = 0; i < len; i++) {
      // add a definition to typeByCode table
      // to handle synonyms, if same code appears more than once then uses name from last definition in list
      let [name, code] = keywords[i];
      if (!(name === "missing value" && code === objc.cMissingValue)) { // (ignore `missing value` as it's treated separately)
        // escape definitions that semi-overlap default definitions
        const typeDef = this._defaultTypesByName[name]; // [DESC_CONSTRUCTOR, OSTYPE]
        if (typeDef !== undefined && typeDef.code !== code) {
          name = keywords[i].name = escapeIdentifier(name); // change name in-place
        }
        // add item
        this.typesByCode[code] = {type, name};
      }
      // add a definition to typeByName table
      // to handle synonyms, if same name appears more than once then uses code from first definition in list (iterating array in reverse ensures this)
      [name, code] = keywords[len - 1 - i];
      if (!(name === "missing value" && code === objc.cMissingValue)) { // (ignore `missing value` as it's treated separately)
        // escape definitions that semi-overlap default definitions
        const typeDef = this._defaultTypesByName[name];
        if (typeDef !== undefined && typeDef.code !== code) {
          name = keywords[len - 1 - i].name = escapeIdentifier(name);
        }
        // add item
        this.typesByName[name] = {type, code}; // best not share {type,name,code} objects between typesByName and typesByCode tables, as in-place changes could screw them up
      }
    }
  };

  this._addSpecifierKeywords = function(keywords, nameTable, codeTable, defaultKeywordsByName) {
    const len = keywords.length;
    for (let i = 0; i< len; i++) {
      // add a definition to the elementsByCode/propertiesByCode table
      // to handle synonyms, if same code appears more than once then uses name from last definition in list
      let [name, code] = keywords[i];
      let defaultCode = defaultKeywordsByName[name];
      if (defaultCode !== undefined && code !== defaultCode) {
        name = keywords[i][0] = escapeIdentifier(name);
      }
      codeTable[code] = name;
      // add a definition to the elementsByName/propertiesByName table
      // to handle synonyms, if same name appears more than once then uses code from first definition in list (iterating array in reverse ensures this)
      [name, code] = keywords[len - 1 - i];
      defaultCode = defaultKeywordsByName[name];
      if (defaultCode !== undefined && code !== defaultCode) {
        name = keywords[len - 1 - i][0] = escapeIdentifier(name);
      }
      nameTable[name] = code;
    }
  };

  this._addCommandKeywords = function(commands) {
    const len = commands.length;
    for (let i = 0; i< len; i++) {
      // to handle synonyms, if two commands have same name but different codes, only the first definition should be used (iterating array in reverse ensures this)
      const term = commands[len - 1 - i];
      let name = term.name;
      const eventClass = term.eventClass;
      const eventID = term.eventID;
      // Avoid collisions between default commands and application-defined commands with same name
      // but different code (e.g. 'get' and 'set' in InDesign CS2):
      const existingCommandDef = this._defaultCommandsByName[name];
      if (existingCommandDef !== undefined && (existingCommandDef.eventClass != eventClass 
                                            || existingCommandDef.eventID != eventID)) {
        name = term.name = escapeIdentifier(name);
      }
      // add item
      this.commandsByName[name] = term;
    }
  };

  // called by parseSDEF 
  // (note: default terminology is added automatically when GlueTable is instantiated; users should not add it themselves)
  this.addTerminology = function(terms) { // terms = {types:,enumerators:,properties:,elements:,commands:}
    // build type tables
    this._addSymbolKeywords(terms.properties, kae.typeType); // technically typeProperty, but typeType is prob. safest
    this._addSymbolKeywords(terms.enumerators, kae.typeEnumerated);
    this._addSymbolKeywords(terms.types, kae.typeType);
    // build specifier tables
    this._addSpecifierKeywords(terms.elements, this.elementsByName,
                               this.elementsByCode, this._defaultElementsByName);
    this._addSpecifierKeywords(terms.properties, this.propertiesByName,
                               this.propertiesByCode, this._defaultPropertiesByName);
    // build command table
    this._addCommandKeywords(terms.commands);
    // special case: if property table contains a 'text' definition, move it to element table
    // (AppleScript always packs 'text of...' as an all-elements specifier, not a property specifier)
    const code = this.propertiesByName["text"];
    if (code !== undefined) {
      this.elementsByName["text"] = code;
      delete this.propertiesByName["text"];
    }
  };
  
  // add NodeAutomation's built-in terms, used to disambiguate any conflicting app-defined names    
  this.addTerminology(kDefaultTerminology);
  // retain copies of default type and command terms; these will be used to disambiguate
  // any conflicting application-defined terms added later
  this._defaultTypesByName = Object.assign({}, this.typesByName);
  this._defaultPropertiesByName = Object.assign({}, this.propertiesByName);
  this._defaultElementsByName = Object.assign({}, this.elementsByName);
  this._defaultCommandsByName = Object.assign({}, this.commandsByName);
  
  //
  
  this.addSDEF = function(data) { // NSData
    let parser = new SDEFParser();
    parser.parse(data);
    this.addTerminology(parser);
  };
  
  this.addSDEFAtURL = function(url) { // NSURL may be file:// or eppc://
    this.addSDEF(getScriptingDefinition(url));
  };
}


/****************************************************************************************/
// MAIN

const _glueCache = {};

function glueTableForApplication(url) { // file/eppc NSURL -> GlueTable
  let glue = _glueCache[url];
  if (glue === undefined) {
    glue = _glueCache[url] = new GlueTable();
    try {
      glue.addSDEFAtURL(url);
    } catch (e) { // ignore error -192 as app is [presumably] 'non-scriptable'
      if (!(e instanceof aeerrors.TerminologyError && e.number === -192)) { throw e; } 
    }
  }
  return glue;
}


function exportRawTerminology(applicationPath, outputPath = null) { // export raw terminology tables to object/file
  const url = aesupport.fileURLForLocalApplication(applicationPath); // accepts app name or full path
  const sdef = new SDEFParser();
  sdef.parse(getScriptingDefinition(url));
  const data = {appleEventBridgeName: "NodeAutomation", appleEventBridgeVersion: kGlueVersion,
                types:sdef.types, enumerators:sdef.enumerators, properties:sdef.properties,
                elements:sdef.elements, commands:sdef.commands};
  if (outputPath) {
    require('fs').writeFileSync(outputPath, JSON.stringify(data, null, '  '), {encoding: 'utf8'});
  } else {
      return data;
  }
}


/****************************************************************************************/


module.exports.GlueTable                = GlueTable;
module.exports.glueTableForApplication  = glueTableForApplication;
module.exports.exportRawTerminology     = exportRawTerminology;

