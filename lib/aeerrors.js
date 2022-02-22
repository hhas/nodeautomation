#!/usr/bin/env node

'use strict';

// TO DO: how to make CommandError show parent error's stack trace in addition to its own? (in Python, errors would be chained using `raise ERR2 from ERR1`)


// note: Node.js seems to like showing Errors' internal state onto stderr when an uncaught error propages to top level of script, ignoring [util.inspect.custom] and other methods being implemented on Error and/or on objects it contains; given that AppData instances contain large lookup tables this is both unreadable and unhelpful; storing it in explicitly private ivars at least suppresses that

const util = require('util');

const kae = require('./kae');


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
    return osErrors[number] || `An error occurred.`;
}


/****************************************************************************************/
// sub-errors raised with AppData while packing/sending/unpacking outgoing/reply AppleEvents

class NodeAutomationError extends Error {
	
	constructor(err) {
		super()
		this.number = err;
	}
    
    get _description() { // subclasses should override to return more detailed description of error
		return defaultErrorMessage(this.number);
	}
	
	[Symbol.toString]() { 
//		console.log('TOSTRING');
		return `${this.constructor.name} (${this.number}): ${this._description}`;
	}
	
	[Symbol.toPrimitive](hint) {
		switch (hint) {
		case 'number':
			return this.number;
		default:
			return this[Symbol.toString]();
		}
	}
	
	[util.inspect.custom](depth, opts, inspect) { 
	//		console.log('INSPECT '+this.constructor.name);
		return this[Symbol.toString](); 
	}
}



class InternalError extends NodeAutomationError { // used by CommandError to wrap unexpected errors

	constructor(parentError) { 
		super(-2700);
		this.parentError = parentError;
    }
    
    get _description() {
    	return `A bug occurred: ${this.parentError}`;
    }
}


// all known errors should be mapped to one of below; anything else is either a bug or sloppy error trapping

class TerminologyError extends NodeAutomationError {

	constructor(message, number = kae.errOSACorruptTerminology) {
		super(number);
		this.message = message;
	}
	
    get _description() { return `Bad terminology: ${this.message}`; }
}


class ParameterError extends NodeAutomationError {

	constructor(value, message) {
		super(-1703);
		this.value = value;
		this.message = message;
	}
	
    get _description() { return `${this.message}: ${util.inspect(this.value)}`; }
}


class PackError extends NodeAutomationError {

	constructor(value) {
		super(-1700);
		this.value = value;
	}
	
    get _description() {
    	let value = this.value;
    	let type = typeof value === 'object' ? value.constructor.name : typeof value;
//    	if (type === 'Buffer' && value.type) { value = value.type.ffi_type || '[Buffer]'; }
//    	console.log('>>'+type+'   '+(value.type && value.type.ffi_type))
    	return `Can't pack ${type}: ${util.inspect(value)}`;
    }
}


class UnpackError extends NodeAutomationError {

	constructor(value) {
		super(-1700);
		this.value = value;
	}
	
    get _description() { return `Can't unpack descriptor: ${this.value}`; }
}


class ConnectionError extends NodeAutomationError {

	constructor(message, number = kae.errOSACantLaunch) {
		super(number);
		this.message = message;
	}
	
    get _description() { return this.message || defaultErrorMessage(this.number); }
}


class AppleEventManagerError extends NodeAutomationError {

	constructor(number) { // Apple event failed; e.g. process not found, event timed out
		super(number);
    }
    
    get _description() { return `Can't send Apple event: ${defaultErrorMessage(this.number)}`; }
}



class ApplicationError extends NodeAutomationError {
	#appData;
	#replyEvent;
	
	constructor(appData, replyEvent) { // application returned error; e.g. bad parameter, object not found
		if (!replyEvent) { throw new TypeError('ApplicationError() expected replyEvent but received '+(typeof replyEvent)); }
		super(replyEvent.paramDescriptorForKeyword_(kae.keyErrorNumber).int32Value());
		this.#appData = appData;
		this.#replyEvent = replyEvent;
	}
	
	_unpackParam(paramKey) {
		const resultDesc = this.#replyEvent.paramDescriptorForKeyword_(paramKey);
		if (resultDesc) {
			try {
				return this.#appData.unpack(resultDesc);
			} catch (e) {
				return resultDesc;
			}
		}
		return null;
	}
    
    get _description() { return this.errorMessage || defaultErrorMessage(this.number); }
    
    // additional error information may optionally be returned by an application, depending on implementation quality/error type
    
    get errorMessage() { // application returned its own (hopefully more detailed!) description of problem
    	return this._unpackParam(kae.keyErrorString);
    }
    
    get expectedType() { // typically returned on coercion errors (-1700)
    	return this._unpackParam(kae.kOSAErrorExpectedType);
    }
    
    get offendingObject() { // typically returned when an object specifier failed to resolve (e.g. -1728)
    	return this._unpackParam(kae.kOSAErrorOffendingObject);
    }
}


/****************************************************************************************/
// public error raised by commands; this provides description of failed command, in addition to above error details

class CommandError extends NodeAutomationError {
	#appData;
    #commandDef;
    #parentSpecifierRecord;
    #parametersObject;
    
	static isCommandError(value) { return value instanceof CommandError; }

	constructor(appData, commandDef, parentSpecifierRecord, parametersObject, parentError) {
		if (!(parentError instanceof NodeAutomationError)) { parentError = new InternalError(parentError); }
		super(parentError.number);
		this.#appData = appData;
		this.#commandDef = commandDef;
		this.#parentSpecifierRecord = parentSpecifierRecord;
		this.#parametersObject = parametersObject;
		this.parentError = parentError;
		//this.description = this._description;
	}
    
    // (note: the following expect parentError to be some sort of object; throwing primitives = implementation bug)
    
    get _description() {
        try {
            let result = this.errorMessage
						 || this.parentError._description
						 || defaultErrorMessage(this.parentError.number);
            result += `\n\n${this.commandDescription}`;
            const expectedType = this.expectedType;
            if (expectedType !== null) { result += `\n\nExpected type: ${this.expectedType}`; }
            const offendingObject = this.offendingObject;
            if (offendingObject !== null) { 
            	result += `\n\nOffending object:\n\n${util.inspect(this.offendingObject)}`;
            }
            if (this.parentError instanceof InternalError) { // report a bug in nodeautomation
            	result += `\n\n${this.parentError.parentError.stack}`;
            }
            return result.replace(/\n/g, '\n\t');
        } catch (e) {
            return `CommandError._description bug: ${e}\n${e instanceof Error ? e.stack : ''}\n`; // DEBUG
        }
    }
    
    get errorNumber() { return this.number; }
    
    get errorMessage() { return this.parentError.errorMessage || null; }
    
    get expectedType() { return this.parentError.expectedType || null; }
    
    get offendingObject() { return this.parentError.offendingObject || null; }
    
    get commandDescription() {
        return require('./aeformatter').formatCommand(this.#appData, this.#commandDef, 
        											  this.#parentSpecifierRecord, this.#parametersObject);
    }
}




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

