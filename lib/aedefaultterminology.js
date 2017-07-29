#!/usr/bin/env node

'use strict';

// default terminology

const objc = require('./objc');


/****************************************************************************************/


const _GURL = 0x4755524c; // "#GURL"
const _WIND = 0x57494e44; // "#WIND"
const _pALL = 0x70414c4c; // "#pALL"


module.exports = {

    types: [["anything", objc.typeWildCard],
            ["boolean", objc.typeBoolean],
            ["shortInteger", objc.typeSInt16],
            ["integer", objc.typeSInt32],
            ["doubleInteger", objc.typeSInt64],
            ["unsignedShortInteger", objc.typeUInt16], // no AS keyword
            ["unsignedInteger", objc.typeUInt32],
            ["unsignedDoubleInteger", objc.typeUInt64], // no AS keyword
            ["fixed", objc.typeFixed],
            ["longFixed", objc.typeLongFixed],
            ["decimalStruct", objc.typeDecimalStruct], // no AS keyword
            ["smallReal", objc.typeIEEE32BitFloatingPoint],
            ["real", objc.typeIEEE64BitFloatingPoint],
//            ["extendedReal", objc.typeExtended],
            ["largeReal", objc.type128BitFloatingPoint], // no AS keyword
            ["string", objc.typeText],
//            ["styledText", objc.typeStyledText], // long deprecated; really shouldn't appear now
//            ["textStyleInfo", objc.typeTextStyles],
//            ["styledClipboardText", objc.typeScrapStyles],
//            ["encodedString", objc.typeEncodedString],
//            ["writingCode", objc.pScriptTag],
//            ["internationalWritingCode", objc.typeIntlWritingCode],
//            ["internationalText", objc.typeIntlText],
            ["UnicodeText", objc.typeUnicodeText],
            ["UTF8Text", objc.typeUTF8Text], // no AS keyword
            ["UTF16Text", objc.typeUTF16ExternalRepresentation], // no AS keyword
            ["version", objc.typeVersion],
            ["date", objc.typeLongDateTime],
            ["list", objc.typeAEList],
            ["record", objc.typeAERecord],
            ["data", objc.typeData],
            ["script", objc.typeScript],
            ["locationReference", objc.typeInsertionLoc], // AppleScript terminology
            ["reference", objc.typeObjectSpecifier], // AppleScript terminology
            ["locationSpecifier", objc.typeInsertionLoc], // Cocoa Scripting terminology
            ["specifier", objc.typeObjectSpecifier], // Cocoa Scripting terminology
            ["alias", objc.typeAlias],
            ["fileRef", objc.typeFSRef], // no AS keyword
//            ["fileSpecification", objc.typeFSS], // long deprecated; really shouldn't appear now
            ["bookmarkData", objc.typeBookmarkData], // no AS keyword
            ["fileURL", objc.typeFileURL], // no AS keyword
            ["point", objc.typeQDPoint],
            ["boundingRectangle", objc.typeQDRectangle],
            ["fixedPoint", objc.typeFixedPoint],
            ["fixedRectangle", objc.typeFixedRectangle],
            ["longPoint", objc.typeLongPoint],
            ["longRectangle", objc.typeLongRectangle],
            ["longFixedPoint", objc.typeLongFixedPoint],
            ["longFixedRectangle", objc.typeLongFixedRectangle],
            ["EPSPicture", objc.typeEPS],
            ["GIFPicture", objc.typeGIF],
            ["JPEGPicture", objc.typeJPEG],
            ["PICTPicture", objc.typePict],
            ["TIFFPicture", objc.typeTIFF],
            ["RGBColor", objc.typeRGBColor],
            ["RGB16Color", objc.typeRGB16],
            ["RGB96Color", objc.typeRGB96],
            ["graphicText", objc.typeGraphicText],
            ["colorTable", objc.typeColorTable],
            ["pixelMapRecord", objc.typePixMapMinus],
            ["best", objc.typeBest],
            ["typeClass", objc.typeType],
            ["constant", objc.typeEnumeration],
            ["property", objc.typeProperty],
            ["machPort", objc.typeMachPort], // no AS keyword
            ["kernelProcessID", objc.typeKernelProcessID], // no AS keyword
            ["applicationBundleID", objc.typeApplicationBundleID], // no AS keyword
            ["processSerialNumber", objc.typeProcessSerialNumber], // no AS keyword
            ["applicationSignature", objc.typeApplSignature], // no AS keyword
            ["applicationURL", objc.typeApplicationURL], // no AS keyword
//            ["missing value", objc.cMissingValue], // represented as null, not Keyword instance
            ["null", objc.typeNull],
            ["machineLocation", objc.typeMachineLoc],
            ["machine", objc.cMachine],
            ["dashStyle", objc.typeDashStyle],
            ["rotation", objc.typeRotation],
            ["item", objc.cObject],
            ["January", objc.cJanuary],
            ["February", objc.cFebruary],
            ["March", objc.cMarch],
            ["April", objc.cApril],
            ["May", objc.cMay],
            ["June", objc.cJune],
            ["July", objc.cJuly],
            ["August", objc.cAugust],
            ["September", objc.cSeptember],
            ["October", objc.cOctober],
            ["November", objc.cNovember],
            ["December", objc.cDecember],
            ["Sunday", objc.cSunday],
            ["Monday", objc.cMonday],
            ["Tuesday", objc.cTuesday],
            ["Wednesday", objc.cWednesday],
            ["Thursday", objc.cThursday],
            ["Friday", objc.cFriday],
            ["Saturday", objc.cSaturday],
    ],
    
    enumerators: [["yes", objc.kAEYes],
                  ["no", objc.kAENo],
                  ["ask", objc.kAEAsk],
                  ["case", objc.kAECase],
                  ["diacriticals", objc.kAEDiacritic],
                  ["expansion", objc.kAEExpansion],
                  ["hyphens", objc.kAEHyphens],
                  ["punctuation", objc.kAEPunctuation],
                  ["whitespace", objc.kAEWhiteSpace],
                  ["numericStrings", objc.kASNumericStrings],
    ],
    
    properties: [["class", objc.pClass], // always supported by Cocoa Scripting, though often omitted in .sdef
                 ["properties", _pALL], // ditto
                 ["id", objc.pID],
    ],

    elements: [["items", objc.cObject],
               ["text", objc.cText],
    ],

    commands: [{name:"run", eventClass:objc.kCoreEventClass, eventID:objc.kAEOpenApplication, params:{}},
               {name:"open", eventClass:objc.kCoreEventClass, eventID:objc.kAEOpenDocuments, params:{}},
               {name:"print", eventClass:objc.kCoreEventClass, eventID:objc.kAEPrintDocuments, params:{}},
               {name:"quit", eventClass:objc.kCoreEventClass, eventID:objc.kAEQuitApplication, 
                                                                               params:{"saving":objc.keyAESaveOptions}},
               {name:"reopen", eventClass:objc.kCoreEventClass, eventID:objc.kAEReopenApplication, params:{}},
               {name:"activate", eventClass:objc.kAEMiscStandards, eventID:objc.kAEActivate, params:{}},
               {name:"openLocation", eventClass:_GURL, eventID:_GURL, params:{"window":_WIND}},
               {name:"get", eventClass:objc.kAECoreSuite, eventID:objc.kAEGetData, params:{}},
               {name:"set", eventClass:objc.kAECoreSuite, eventID:objc.kAESetData, params:{"to":objc.keyAEData}},
    ], // note: 'launch' command is not defined here as it's hardcoded custom behavior
};
    
