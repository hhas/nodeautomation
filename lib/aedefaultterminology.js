#!/usr/bin/env node

'use strict';

// default terminology

const kae = require('./kae');


/****************************************************************************************/


const _GURL = 0x4755524c; // "#GURL"
const _WIND = 0x57494e44; // "#WIND"
const _pALL = 0x70414c4c; // "#pALL"


module.exports = {

    types: [["anything", kae.typeWildCard],
            ["boolean", kae.typeBoolean],
            ["shortInteger", kae.typeSInt16],
            ["integer", kae.typeSInt32],
            ["doubleInteger", kae.typeSInt64],
            ["unsignedShortInteger", kae.typeUInt16], // no AS keyword
            ["unsignedInteger", kae.typeUInt32],
            ["unsignedDoubleInteger", kae.typeUInt64], // no AS keyword
            ["fixed", kae.typeFixed],
            ["longFixed", kae.typeLongFixed],
            ["decimalStruct", kae.typeDecimalStruct], // no AS keyword
            ["smallReal", kae.typeIEEE32BitFloatingPoint],
            ["real", kae.typeIEEE64BitFloatingPoint],
//            ["extendedReal", kae.typeExtended],
            ["largeReal", kae.type128BitFloatingPoint], // no AS keyword
            ["string", kae.typeText],
//            ["styledText", kae.typeStyledText], // long deprecated; really shouldn't appear now
//            ["textStyleInfo", kae.typeTextStyles],
//            ["styledClipboardText", kae.typeScrapStyles],
//            ["encodedString", kae.typeEncodedString],
//            ["writingCode", kae.pScriptTag],
//            ["internationalWritingCode", kae.typeIntlWritingCode],
//            ["internationalText", kae.typeIntlText],
            ["UnicodeText", kae.typeUnicodeText],
            ["UTF8Text", kae.typeUTF8Text], // no AS keyword
            ["UTF16Text", kae.typeUTF16ExternalRepresentation], // no AS keyword
            ["version", kae.typeVersion],
            ["date", kae.typeLongDateTime],
            ["list", kae.typeAEList],
            ["record", kae.typeAERecord],
            ["data", kae.typeData],
            ["script", kae.typeScript],
            ["locationReference", kae.typeInsertionLoc], // AppleScript terminology
            ["reference", kae.typeObjectSpecifier], // AppleScript terminology
            ["locationSpecifier", kae.typeInsertionLoc], // Cocoa Scripting terminology
            ["specifier", kae.typeObjectSpecifier], // Cocoa Scripting terminology
            ["alias", kae.typeAlias],
            ["fileRef", kae.typeFSRef], // no AS keyword
//            ["fileSpecification", kae.typeFSS], // long deprecated; really shouldn't appear now
            ["bookmarkData", kae.typeBookmarkData], // no AS keyword
            ["fileURL", kae.typeFileURL], // no AS keyword
            ["point", kae.typeQDPoint],
            ["boundingRectangle", kae.typeQDRectangle],
            ["fixedPoint", kae.typeFixedPoint],
            ["fixedRectangle", kae.typeFixedRectangle],
            ["longPoint", kae.typeLongPoint],
            ["longRectangle", kae.typeLongRectangle],
            ["longFixedPoint", kae.typeLongFixedPoint],
            ["longFixedRectangle", kae.typeLongFixedRectangle],
            ["EPSPicture", kae.typeEPS],
            ["GIFPicture", kae.typeGIF],
            ["JPEGPicture", kae.typeJPEG],
            ["PICTPicture", kae.typePict],
            ["TIFFPicture", kae.typeTIFF],
            ["RGBColor", kae.typeRGBColor],
            ["RGB16Color", kae.typeRGB16],
            ["RGB96Color", kae.typeRGB96],
            ["graphicText", kae.typeGraphicText],
            ["colorTable", kae.typeColorTable],
            ["pixelMapRecord", kae.typePixMapMinus],
            ["best", kae.typeBest],
            ["typeClass", kae.typeType],
            ["constant", kae.typeEnumeration],
            ["property", kae.typeProperty],
            ["machPort", kae.typeMachPort], // no AS keyword
            ["kernelProcessID", kae.typeKernelProcessID], // no AS keyword
            ["applicationBundleID", kae.typeApplicationBundleID], // no AS keyword
            ["processSerialNumber", kae.typeProcessSerialNumber], // no AS keyword
            ["applicationSignature", kae.typeApplSignature], // no AS keyword
            ["applicationURL", kae.typeApplicationURL], // no AS keyword
//            ["missing value", kae.cMissingValue], // represented as null, not Keyword instance
            ["null", kae.typeNull],
            ["machineLocation", kae.typeMachineLoc],
            ["machine", kae.cMachine],
            ["dashStyle", kae.typeDashStyle],
            ["rotation", kae.typeRotation],
            ["item", kae.cObject],
            ["January", kae.cJanuary],
            ["February", kae.cFebruary],
            ["March", kae.cMarch],
            ["April", kae.cApril],
            ["May", kae.cMay],
            ["June", kae.cJune],
            ["July", kae.cJuly],
            ["August", kae.cAugust],
            ["September", kae.cSeptember],
            ["October", kae.cOctober],
            ["November", kae.cNovember],
            ["December", kae.cDecember],
            ["Sunday", kae.cSunday],
            ["Monday", kae.cMonday],
            ["Tuesday", kae.cTuesday],
            ["Wednesday", kae.cWednesday],
            ["Thursday", kae.cThursday],
            ["Friday", kae.cFriday],
            ["Saturday", kae.cSaturday],
    ],
    
    enumerators: [["yes", kae.kAEYes],
                  ["no", kae.kAENo],
                  ["ask", kae.kAEAsk],
                  ["case", kae.kAECase],
                  ["diacriticals", kae.kAEDiacritic],
                  ["expansion", kae.kAEExpansion],
                  ["hyphens", kae.kAEHyphens],
                  ["punctuation", kae.kAEPunctuation],
                  ["whitespace", kae.kAEWhiteSpace],
                  ["numericStrings", kae.kASNumericStrings],
    ],
    
    properties: [["class", kae.pClass], // always supported by Cocoa Scripting, though often omitted in .sdef
                 ["properties", _pALL], // ditto
                 ["id", kae.pID],
    ],

    elements: [["items", kae.cObject],
               ["text", kae.cText],
    ],

    commands: [{name:"run", eventClass:kae.kCoreEventClass, eventID:kae.kAEOpenApplication, params:{}},
               {name:"open", eventClass:kae.kCoreEventClass, eventID:kae.kAEOpenDocuments, params:{}},
               {name:"print", eventClass:kae.kCoreEventClass, eventID:kae.kAEPrintDocuments, params:{}},
               {name:"quit", eventClass:kae.kCoreEventClass, eventID:kae.kAEQuitApplication, 
                                                                               params:{"saving":kae.keyAESaveOptions}},
               {name:"reopen", eventClass:kae.kCoreEventClass, eventID:kae.kAEReopenApplication, params:{}},
               {name:"activate", eventClass:kae.kAEMiscStandards, eventID:kae.kAEActivate, params:{}},
               {name:"openLocation", eventClass:_GURL, eventID:_GURL, params:{"window":_WIND}},
               {name:"get", eventClass:kae.kAECoreSuite, eventID:kae.kAEGetData, params:{}},
               {name:"set", eventClass:kae.kAECoreSuite, eventID:kae.kAESetData, params:{"to":kae.keyAEData}},
    ], // note: 'launch' command is not defined here as it's hardcoded custom behavior
};
    
