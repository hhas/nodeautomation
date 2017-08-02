#!/usr/bin/env node

'use strict';

const util = require('util');

const objc = require('./objc');


/****************************************************************************************/
// default error messages for common Carbon error numbers

const osErrors = {
        // OS errors
        "-34": "Disk is full.",
        "-35": "Disk wasn't found.",
        "-37": "Bad name for file.",
        "-38": "File wasn't open.",
        "-39": "End of file error.",
        "-42": "Too many files open.",
        "-43": "File wasn't found.",
        "-44": "Disk is write protected.",
        "-45": "File is locked.",
        "-46": "Disk is locked.",
        "-47": "File is busy.",
        "-48": "Duplicate file name.",
        "-49": "File is already open.",
        "-50": "Parameter error.",
        "-51": "File reference number error.",
        "-61": "File not open with write permission.",
        "-108": "Out of memory.",
        "-120": "Folder wasn't found.",
        "-124": "Disk is disconnected.",
        "-128": "User canceled.",
        "-192": "A resource wasn't found.",
        "-600": "Application isn't running.",
        "-601": "Not enough room to launch application with special requirements.",
        "-602": "Application is not 32-bit clean.",
        "-605": "More memory is needed than is specified in the size resource.",
        "-606": "Application is background-only.",
        "-607": "Buffer is too small.",
        "-608": "No outstanding high-level event.",
        "-609": "Connection is invalid.",
        "-610": "No user interaction allowed.",
        "-904": "Not enough system memory to connect to remote application.",
        "-905": "Remote access is not allowed.",
        "-906": "Application isn't running or program linking isn't enabled.",
        "-915": "Can't find remote machine.",
        "-30720": "Invalid date and time.",
        // AE errors
        "-1700": "Can't make some data into the expected type.",
        "-1701": "Some parameter is missing for command.",
        "-1702": "Some data could not be read.",
        "-1703": "Some data was the wrong type.",
        "-1704": "Some parameter was invalid.",
        "-1705": "Operation involving a list item failed.",
        "-1706": "Need a newer version of the Apple Event Manager.",
        "-1707": "Event isn't an Apple event.",
        "-1708": "Application could not handle this command.",
        "-1709": "AEResetTimer was passed an invalid reply.",
        "-1710": "Invalid sending mode was passed.",
        "-1711": "User canceled out of wait loop for reply or receipt.",
        "-1712": "Apple event timed out.",
        "-1713": "No user interaction allowed.",
        "-1714": "Wrong keyword for a special function.",
        "-1715": "Some parameter wasn't understood.",
        "-1716": "Unknown Apple event address type.",
        "-1717": "The handler is not defined.",
        "-1718": "Reply has not yet arrived.",
        "-1719": "Can't get reference. Invalid index.",
        "-1720": "Invalid range.",
        "-1721": "Wrong number of parameters for command.",
        "-1723": "Can't get reference. Access not allowed.",
        "-1725": "Illegal logical operator called.",
        "-1726": "Illegal comparison or logical.",
        "-1727": "Expected a reference.",
        "-1728": "Can't get reference.",
        "-1729": "Object counting procedure returned a negative count.",
        "-1730": "Container specified was an empty list.",
        "-1731": "Unknown object type.",
        "-1739": "Attempting to perform an invalid operation on a null descriptor.",
        // Application scripting errors
        "-10000": "Apple event handler failed.",
        "-10001": "Type error.",
        "-10002": "Invalid key form.",
        "-10003": "Can't set reference to given value. Access not allowed.",
        "-10004": "A privilege violation occurred.",
        "-10005": "The read operation wasn't allowed.",
        "-10006": "Can't set reference to given value.",
        "-10007": "The index of the event is too large to be valid.",
        "-10008": "The specified object is a property, not an element.",
        "-10009": "Can't supply the requested descriptor type for the data.",
        "-10010": "The Apple event handler can't handle objects of this class.",
        "-10011": "Couldn't handle this command because it wasn't part of the current transaction.",
        "-10012": "The transaction to which this command belonged isn't a valid transaction.",
        "-10013": "There is no user selection.",
        "-10014": "Handler only handles single objects.",
        "-10015": "Can't undo the previous Apple event or user action.",
        "-10023": "Enumerated value is not allowed for this property.",
        "-10024": "Class can't be an element of container.",
        "-10025": "Illegal combination of properties settings."
};


function defaultErrorMessage(number) {
    return osErrors[number] || `Error ${number}.`;
}


/****************************************************************************************/
// sub-errors raised with AppData while packing/sending/unpacking outgoing/reply AppleEvents

function _setErrorPrototype(fn) {
    fn.prototype = Object.create(Error.prototype);
    fn.prototype.constructor = fn;
    fn.prototype.toString = fn.prototype.inspect = function() { return `${fn.name}: ${this.message}`; };
}


function InternalError(parentError) { // all known errors should be mapped to one of below; anything else is either a bug or sloppy error trapping
    this.number = -2700;
    this.message = `Internal error: ${parentError}`;
}
_setErrorPrototype(InternalError);


function TerminologyError(message, number = objc.errOSACorruptTerminology) {
    this.number = number;
    this.message = `Bad terminology: ${message}`;
}
_setErrorPrototype(TerminologyError);


function ParameterError(value, message) {
    this.number = -1703;
    this.value = value;
    this.message = `${message}: ${util.inspect(value)}`;
}
_setErrorPrototype(ParameterError);


function PackError(value) {
    this.number = -1700;
    this.value = value;
    this.message = `Can't pack ${typeof value}: ${value}`;
}
_setErrorPrototype(PackError);


function UnpackError(value) {
    this.number = -1700;
    this.value = value;
    this.message = `Can't unpack descriptor: ${value}`;
}
_setErrorPrototype(UnpackError);


function ConnectionError(message, number = objc.errOSACantLaunch) {
    this.number = number;
    this.message = message;
}
_setErrorPrototype(ConnectionError);


function AppleEventManagerError(number) { // e.g. process not found, event timed out
    this.number = number;
    this.message = 'Apple Event Manager error.';
}
_setErrorPrototype(AppleEventManagerError);


function ApplicationError(appData, replyEvent) {
    
    function _unpackParam(paramKey) {
        const resultDesc = replyEvent('paramDescriptorForKeyword', paramKey);
        if (resultDesc) {
            try {
                return appData.unpack(resultDesc);
            } catch (e) {
                return resultDesc;
            }
        }
        return null;
    }
    
    this.number = _unpackParam(objc.keyErrorNumber);
    
    this.errorMessage = function() {
        return _unpackParam(objc.keyErrorString) || defaultErrorMessage(this.number);
    };
    
    this.expectedType = function() {
        return _unpackParam(objc.kOSAErrorExpectedType);
    };
    
    this.offendingObject = function() {
        return _unpackParam(objc.kOSAErrorOffendingObject);
    };
    
    this.message = 'Application error.';
}
_setErrorPrototype(ApplicationError);


/****************************************************************************************/
// public error raised by commands; this provides description of failed command, in addition to above error details

function CommandError(appData, commandDef, parentSpecifierRecord, parametersObject, parentError) {
    this.number = parentError.number || -2700;
    
    // TO DO: rework as properties, not methods
    
    // (note: the following expect parentError to be some sort of object; throwing primitives = implementation bug)
    
    this.errorNumber = function() { return this.number; };
    
    this.errorMessage = function() {
        return (parentError.message || defaultErrorMessage(this.number));
    };
    
    this.expectedType = function() {
        return (typeof parentError.expectedType === 'function') ? parentError.expectedType() : null;
    };
    
    this.offendingObject = function() {
        return (typeof parentError.offendingObject === 'function') ? parentError.offendingObject() : null;
    };
    
    this.commandDescription = function() {
        return require('./aeformatter').formatCommand(appData, commandDef, parentSpecifierRecord, parametersObject);
    };
    
    this.toString = function() {
        try {
            var result = `CommandError: ${this.errorMessage()} (${this.number})`;
            result += `\n\nFailed command:\n\n\t${this.commandDescription()}`;
            const expectedType = this.expectedType();
            const offendingObject = this.offendingObject();
            if (expectedType !== null) { result += `\n\nExpected type: ${expectedType}`; }
            if (offendingObject !== null) { result += `\n\nOffending object:\n\n\t${offendingObject}`; }
            return `${result}\n\n${parentError.message}`;
        } catch (e) {
            return `CommandError.toString() bug: ${e}`; // DEBUG
        }
    };
    this.message = this.toString(); // TO DO: don't really want to generate full error string unless/until needed
    this.valueOf = this[Symbol.toPrimitive] = this.inspect = this.toString;
}
_setErrorPrototype(CommandError);

CommandError.isCommandError = function(value) { return value instanceof CommandError; };



/****************************************************************************************/


module.exports = {
    InternalError: InternalError,
    TerminologyError: TerminologyError,
    ParameterError: ParameterError,
    PackError: PackError,
    UnpackError: UnpackError,
    ConnectionError: ConnectionError,
    AppleEventManagerError: AppleEventManagerError,
    ApplicationError: ApplicationError,
    CommandError: CommandError,
};

