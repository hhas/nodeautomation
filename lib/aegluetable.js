#!/usr/bin/env node

'use strict';

// aegluetable


// note: The default `ascrgsdf` handler is buggy in apps that don't include a native .sdef file, e.g. TextEdit throws 'resource not found' error -192 instead of generating sdef data from its .scriptTerminology resource. Could file a Radar, but probably not worth it as Apple don't appear to care about Automation anyway.

const ffi = require('ffi-napi');
var ref = require('ref-napi');

const objc = require('objc');

const kDefaultTerminology = require('./aedefaultterminology');
const aesupport = require('./aesupport');
const aeerrors = require('./aeerrors');
const kae = require('./kae');


const kVersion = "1.0";


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
    var tmp = Buffer.alloc(4);
    data.getBytes_length_(tmp, 4);
    return tmp.readInt32BE();
}

var _convertedNameCache = {}; // trade memory for speed when converting keywords that appear repeatedly

function convertNameToIdentifier(name) {
    name = objc.js(name);
    var identifier = _convertedNameCache[name];
    if (identifier === undefined) {
        identifier = name.trim().replace(/\s+./g, function(s) { return s.substr(-1).toUpperCase(); });
        if (reservedNames.includes(identifier)) { identifier = escapeIdentifier(identifier); }
        _convertedNameCache[name] = identifier;
    }
    return identifier;
}

function escapeIdentifier(identifier) {
    return `${identifier}_`;
}


const _inspectOptions = {maxArrayLength:null, depth:null};


/****************************************************************************************/
// SDEF parser


function SDEFParser() {    
    // SDEF names and codes are parsed into the following tables
    this.types = []; // [[NAME,CODE],...]
    this.enumerators = [];
    this.properties = [];
    this.elements = [];
    this.commands = []; // [{name:NAME,eventClass:CODE,eventID:CODE,params:{NAME,CODE,...}}
    
    this._commandsDict = {}; // command defs by name; used to disambiguate duplicate command definitions
    
    this._defaultElementsByCode = {}; // may be used if a 'class' element doesn't have 'plural' attribute
    for (var element of kDefaultTerminology.elements) { // name,code
        this._defaultElementsByCode[element[1]] = element[0];
    };
    
    // parse an OSType given as 4/8-character "MacRoman" string, or 10/18-character hex string
    
    this.parseFourCharCode = function(string) { // [NS]String -> OSType; class, property, enum, param, etc. code; 
        string = objc.js(string);
        if (string.match(/^0[xX][0-9a-fA-F]{8}/)) { // e.g. "0x1234ABCD" -> OSType
            return aesupport.UInt32(string); // throws if invalid
        } else {
            return toFourCharCode(string); // e.g. 'ABCD' -> OSType
        }
    };
    
    this.parseEightCharCode = function(string) { // [NS]String -> [OSType, OSType] // eventClass and eventID code
        string = objc.js(string);
        if (string.match(/^0[xX][0-9a-fA-F]{18}/)) { // e.g. "0x1234567890ABCDEF" -> OSType
            return [aesupport.UInt32(string.substring(0,10)), aesupport.UInt32('0x'+string.substring(10))];
        } else {
            return [toFourCharCode(string.substring(0,4)), toFourCharCode(string.substring(4))];
        }
        //  "Invalid eight-char code (wrong length): \((string as String).debugDescription)"
    };
    
    //
    
    this.iter = function(nsarray, func) {
        for (var i = 0; i < nsarray.count(); i++) {
            try {
                func.call(this, nsarray.objectAtIndex_(i));
            } catch (e) {
                console.log(`Ignoring SDEF bug: ${e}`);
            }
        }            
    };
    
    // extract name and code attributes from a class/enumerator/command/etc XML element
    
    this.attribute = function(name, element) { // String, XMLElement -> String/null
        const attr = element.attributeForName_(objc.ns(name));
        return attr ? attr.stringValue() : null;
    };
    
    this.parseKeywordElement = function(element) { // XMLElement -> [String, OSType]
        const name = this.attribute("name", element);
        const codeString = this.attribute("code", element);
        if (!(name && codeString)) { throw new aeerrors.TerminologyError("missing 'name'/'code' attribute."); }
        return [name, this.parseFourCharCode(codeString)];
    };
    
    this.parseCommandElement = function(element) { // XMLElement -> [String, OSType, OSType]
        const name = this.attribute("name", element);
        const codeString = this.attribute("code", element);
        if (!(name && codeString)) { throw new aeerrors.TerminologyError("missing 'name'/'code' attribute."); }
        const [eventClass, eventID] = this.parseEightCharCode(codeString);
        return [name, eventClass, eventID];
    };
    
    //
    
    this.parseTypeOfElement = function(element) { // XMLElement -> [String, OSType] // class, record-type, value-type
        const [name, code] = this.parseKeywordElement(element);
        this.types.push([convertNameToIdentifier(name), code]);
        return [name, code];
    };
    
    this.parsePropertiesOfElement = function(element) { // XMLElement // class, class-extension, record-value
        this.iter(element.elementsForName_(objc.ns("property")), function(element) {
            const [name, code] = this.parseKeywordElement(element);
            this.properties.push([convertNameToIdentifier(name), code]);
        });
    };
    
    // parse a class/enumerator/command/etc element of a dictionary suite
    
    this.parseDefinition = function(element) { // XMLNode
        // bug: objc.NSXMLElement('class') crashes for some reason (+class method works fine on other classes, e.g. NSXMLNode); fortunately, nodobjc accepts class wrapper directly
        if (!element.isKindOfClass_(objc.NSXMLElement)) { return; }
        
//        console.log('parseDefinition: ' + element.name())
        
        switch (objc.js(element.name())) {
        case "class":
            var [name, code] = this.parseTypeOfElement(element);
            this.parsePropertiesOfElement(element);
            // use plural class name as elements name (if not given, append "s" to singular name)
            // (note: record and value types also define plurals, but we only use plurals for element names and elements should always be classes, so we ignore those)
            const plural = element.attributeForName_(objc.ns("plural"));
            var tmp;
            if (plural) {
                tmp = plural.stringValue();
            } else if (this._defaultElementsByCode[code] !== undefined) {
                // default terminology already defines 'items' and 'text' as known element names
                tmp = this._defaultElementsByCode[code];
            } else {
                // note: the spec says to append 's' to name when plural attribute isn't given; in practice, appending 's' doesn't work so well for names already ending in 's' (e.g. 'print settings'), which is really the SDEF's problem; for now we'll omit the second 's' and hope that doesn't confuse with property name
                tmp = objc.js(name).endsWith('s') ? name : `${name}s`;
            }
            const pluralName = convertNameToIdentifier(tmp);
            this.elements.push([pluralName, code]);
            break;
        case "class-extension":
            this.parsePropertiesOfElement(element);
            break;
        case "record-type":
            this.parseTypeOfElement(element);
            this.parsePropertiesOfElement(element);
            break;
        case "value-type":
            this.parseTypeOfElement(element);
            break;
        case "enumeration":
            this.iter(element.elementsForName_(objc.ns("enumerator")), function(element) {
                var [name, code] = this.parseKeywordElement(element);
                this.enumerators.push([convertNameToIdentifier(name), code]);
            });
            break;
        case "command":
        case "event":
            var [name, eventClass, eventID] = this.parseCommandElement(element);
            // Note: overlapping command definitions (e.g. 'path to') should be processed as follows:
            // - If their names and codes are the same, only the last definition is used; other definitions are ignored
            //   and will not compile.
            // - If their names are the same but their codes are different, only the first definition is used; other
            //   definitions are ignored and will not compile.
            var previousDef = this._commandsDict[name];
            if (previousDef===undefined || (previousDef.eventClass === eventClass && previousDef.eventID === eventID)) {
                var command = {name:convertNameToIdentifier(name), eventClass:eventClass, eventID:eventID, params:{}};
                this._commandsDict[name] = command;
                this.iter(element.elementsForName_(objc.ns("parameter")), function(element) {
                    var [name, code] = this.parseKeywordElement(element);
                    command.params[convertNameToIdentifier(name)] = code;
                });
            } // else ignore duplicate declaration
            break;
        }
    }
    
    // parse the given SDEF XML data into this object's types, enumerators, properties, elements, and commands arrays
    
    this.parse = function(sdef) { // NSData
         var error = new objc.InOutRef();
        const parser = objc.NSXMLDocument.alloc().initWithData_options_error_(sdef, 
                                                        					  (1 << 16), // NSXMLDocumentXInclude
                                                          					  error);
        if (!parser) {
            throw new aeerrors.TerminologyError(`can't parse SDEF XML: ${error.deref()}`);
        }
        const dictionary = parser.rootElement();
        if (!dictionary) { throw new aeerrors.TerminologyError("missing `dictionary` element."); }
        const parseDefinition = this.parseDefinition;
        this.iter(dictionary.elementsForName_(objc.ns("suite")), function(suite) {
        	var t = process.hrtime()
            var nodes = suite.children();
            if (nodes) {
                this.iter(nodes, parseDefinition);
            }
            //console.log('parse suite: ' + suite.attributeForName_('name') + process.hrtime(t))
        });
        for (var k in this._commandsDict) { this.commands.push(this._commandsDict[k]); }
    }
}


/****************************************************************************************/
// GlueTable; this constructs the terminology lookup tables used by AppData


function GlueTable() {
    
    this.typesByName = {};      // {String:[constructorName,code]} // Symbol members (properties, types, and enums)
    this.typesByCode = {};      // {OSType:String}
    
    this.elementsByName = {};   // {String:KeywordTerm}
    this.elementsByCode = {};   // {OSType:String}
    
    this.propertiesByName = {}; // {String:KeywordTerm} // e.g. AERecord keys
    this.propertiesByCode = {}; // {OSType:String}
    
    this.commandsByName = {};   // {String:CommandTerm}
    
    this._defaultTypesByName = {};
    this._defaultPropertiesByName = {};
    this._defaultElementsByName = {};
    this._defaultCommandsByName = {};
    
    //
    
    this._addSymbolKeywords = function(keywords, descriptorConstructorName) { // [KeywordTerm], String (method name for constructing typeType/typeEnumerated descriptor)
        const len = keywords.length;
        for (var i = 0; i < len; i++) {
            // add a definition to typeByCode table
            // to handle synonyms, if same code appears more than once then uses name from last definition in list
            var [name, code] = keywords[i];
            if (!(name === "missing value" && code === objc.cMissingValue)) { // (ignore `missing value` as it's treated separately)
                // escape definitions that semi-overlap default definitions
                var typeDef = this._defaultTypesByName[name]; // [DESC_CONSTRUCTOR, OSTYPE]
                if (typeDef !== undefined && typeDef[1] !== code) {
                    name = keywords[i][0] = escapeIdentifier(name); // change name in-place
                }
                // add item
                this.typesByCode[code] = name;
            }
            // add a definition to typeByName table
            // to handle synonyms, if same name appears more than once then uses code from first definition in list (iterating array in reverse ensures this)
            var [name, code] = keywords[len - 1 - i];
            if (!(name === "missing value" && code === objc.cMissingValue)) { // (ignore `missing value` as it's treated separately)
                // escape definitions that semi-overlap default definitions
                var typeDef = this._defaultTypesByName[name];
                if (typeDef !== undefined && typeDef[1] !== code) {
                    name = keywords[len - 1 - i][0] = escapeIdentifier(name);
                }
                // add item
                this.typesByName[name] = [descriptorConstructorName, code];
            }
        }
    };

    this._addSpecifierKeywords = function(keywords, nameTable, codeTable, defaultKeywordsByName) {
        const len = keywords.length;
        for (var i = 0; i< len; i++) {
            // add a definition to the elementsByCode/propertiesByCode table
            // to handle synonyms, if same code appears more than once then uses name from last definition in list
            var [name, code] = keywords[i];
            var defaultCode = defaultKeywordsByName[name];
            if (defaultCode !== undefined && code !== defaultCode) {
                name = keywords[i][0] = escapeIdentifier(name);
            }
            codeTable[code] = name;
            // add a definition to the elementsByName/propertiesByName table
            // to handle synonyms, if same name appears more than once then uses code from first definition in list (iterating array in reverse ensures this)
            var [name, code] = keywords[len - 1 - i];
            var defaultCode = defaultKeywordsByName[name];
            if (defaultCode !== undefined && code !== defaultCode) {
                name = keywords[len - 1 - i][0] = escapeIdentifier(name);
            }
            nameTable[name] = code;
        }
    };

    this._addCommandKeywords = function(commands) {
        const len = commands.length;
        for (var i = 0; i< len; i++) {
            // to handle synonyms, if two commands have same name but different codes, only the first definition should be used (iterating array in reverse ensures this)
            var term = commands[len - 1 - i];
            var name = term.name;
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
        this._addSymbolKeywords(terms.properties, 'descriptorWithTypeCode_'); // technically typeProperty, but typeType is prob. safest
        this._addSymbolKeywords(terms.enumerators, 'descriptorWithEnumCode_');
        this._addSymbolKeywords(terms.types, 'descriptorWithTypeCode_');
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
// quick-n-dirty SDEF translator; replaces AS-style keywords with JS identifiers


function iter(nsarray, func) {
    for (var i = 0; i < nsarray.count(); i++) {
        try {
            func(nsarray.objectAtIndex_(i));
        } catch (e) {
            console.log(`Ignoring SDEF bug: ${e}`);
        }
    }            
}

function translateAttribute(node, attributeName, symbolPrefix = "") { // (XMLElement, String, String)
    const attribute = node.attributeForName_(objc.ns(attributeName));
    if (attribute) {
        const value = attribute.stringValue();
        if (value !== null) {
            attribute.setStringValue_(objc.ns(symbolPrefix + convertNameToIdentifier(value)));
        }
    }
}

function translateType(node) { // XMLElement
    // property/parameter types are described by `type="TYPE"` attribute OR `<type type="TYPE" [list="list"]/>` elements
    translateAttribute(node, "type");
    iter(node.elementsForName_(objc.ns("type")), function(node) { translateType(node); });
}

function setNodeAttribute(node, name, value) {
    node.addAttribute_(objc.NSXMLNode.attributeWithName_stringValue_(objc.ns(name), objc.ns(value)));
}

//

function translateScriptingDefinition(data) { // NSData -> NSData
    var error = new objc.InOutRef();
    const xml = objc.NSXMLDocument.alloc().initWithData_options_error_(data, 
                                                 					   (1 << 16), // NSXMLDocumentXInclude
                                                   					   error);
    if (!xml) { throw new aeerrors.TerminologyError(`Malformed SDEF resource: ${error.deref()}`); }
    const root = xml.rootElement();
    if (!root) { throw new aeerrors.TerminologyError("Malformed SDEF resource: missing root."); }
    // add attributes to root node indicating SDEF has been translated to NA syntax
    setNodeAttribute(root, "apple-event-bridge-name", "NodeAutomation");
    setNodeAttribute(root, "apple-event-bridge-version", kVersion);
    // iterate over suites, converting classes, commands, enums
    iter(root.elementsForName_(objc.ns("suite")), function(suite) {
        for(var key of ["command", "event"]) {
            iter(suite.elementsForName_(objc.ns(key)), function(command) {
                translateAttribute(command, "name");
                for (var key of ["direct-parameter", "result"]) {
                    iter(command.elementsForName_(objc.ns(key)), function(node) {
                        translateType(node);
                    });
                }
                iter(command.elementsForName_(objc.ns("parameter")), function(parameter) {
                    const attribute = parameter.attributeForName_(objc.ns("name"));
                    if (attribute) {
                        const value = attribute.stringValue();
                        if (value !== null) { attribute.setStringValue_(objc.ns(convertNameToIdentifier(value))); }
                    }
                    translateType(parameter);
                });
            });
        }
        for (var key of ["class", "class-extension", "record-type"]) {
            iter(suite.elementsForName_(objc.ns(key)), function(klass) {
                translateAttribute(klass, "name");
                translateAttribute(klass, "plural");
                translateAttribute(klass, "inherits");
                iter(klass.elementsForName_(objc.ns("element")), function(node) {
                    translateAttribute(node, "type");
                });
                iter(klass.elementsForName_(objc.ns("property")), function(node) {
                    translateAttribute(node, "name");
                    translateType(node);
                    // TO DO: if type is sub-element
                });
                iter(klass.elementsForName_(objc.ns("contents")), function(node) {
                    translateAttribute(node, "name");
                });
                iter(klass.elementsForName_(objc.ns("responds-to")), function(node) {
                    translateAttribute(node, "name"); 
                    translateAttribute(node, "command");
                });
            });
        }
        iter(suite.elementsForName_(objc.ns("enumeration")), function(enumeration) {
            iter(enumeration.elementsForName_(objc.ns("enumerator")), function(enumerator) {
                translateAttribute(enumerator, "name", "k.");
            });
        });
        iter(suite.elementsForName_(objc.ns("value-type")), function(valueType) {
            translateAttribute(valueType, "name");
        });
    });
    return xml.XMLDataWithOptions_(1 << 18); // NSXMLDocumentIncludeContentTypeDeclaration
}


/****************************************************************************************/
// MAIN

var _glueCache = {};

function glueTableForApplication(url) { // file/eppc NSURL -> GlueTable
    var glue = _glueCache[url];
    if (glue === undefined) {
        _glueCache[url] = glue = new GlueTable();
        try {
            glue.addSDEFAtURL(url);
        } catch (e) { // ignore error -192 as app is [presumably] 'non-scriptable'
            if (!(e instanceof aeerrors.TerminologyError && e.number === -192)) { throw e; } 
        }
    }
    return glue;
}


function exportSDEFDocumentation(applicationPath, outputPath) { // export modified SDEF for documentation use
    const url = aesupport.fileURLForLocalApplication(applicationPath); // accepts app name or full path
    var result = translateScriptingDefinition(getScriptingDefinition(url));
    if (!result.writeToURL_atomically_(objc.NSURL.fileURLWithPath_(objc.ns(outputPath)), true)) {
        throw new aeerrors.TerminologyError(`Couldn't write SDEF to ${outputPath}`);
    }
}

function exportRawTerminology(applicationPath, outputPath = null) { // export raw terminology tables to object/file
    const url = aesupport.fileURLForLocalApplication(applicationPath); // accepts app name or full path
    const sdef = new SDEFParser();
    sdef.parse(getScriptingDefinition(url));
    const data = {appleEventBridgeName: "NodeAutomation", appleEventBridgeVersion: kVersion,
                  types:sdef.types, enumerators:sdef.enumerators, properties:sdef.properties,
                  elements:sdef.elements, commands:sdef.commands};
    if (outputPath) {
        require('fs').writeFileSync(outputPath, JSON.stringify(data, null, '  '), {encoding: 'utf8'});
    } else {
        return data;
    }
}


/****************************************************************************************/


module.exports = {
    GlueTable:               GlueTable,
    glueTableForApplication: glueTableForApplication,
    exportSDEFDocumentation: exportSDEFDocumentation,
    exportRawTerminology:    exportRawTerminology,
};


// TEST
//exportSDEFDocumentation('Finder','/Users/has/Finder.js.sdef');

//exportRawTerminology('/Applications/Adobe InDesign CS6/Adobe InDesign CS6.app', '/Users/has/InDesign.json');

//exportSDEFDocumentation('Adobe InDesign CS6.app','/Users/has/AdobeInDesignCS6.sdef');

/*

const url = objc.NSURL.fileURLWithPath_('/Applications/TextEdit.app');

//const p = new SDEFParser(); p.parse(getScriptingDefinition(url)); console.log(require('util').inspect(p));

const p = new GlueTable(); p.addSDEFAtURL(url); console.log(p);


exportSDEFDocumentation('/Applications/TextEdit.app', '/Users/has/TextEdit.node.sdef');

exportRawTerminology('/Applications/TextEdit.app', '/Users/has/TextEdit.node.json');

console.log(exportRawTerminology('/Applications/TextEdit.app'));

*/
