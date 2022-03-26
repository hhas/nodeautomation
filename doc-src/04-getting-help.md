# Getting help


## ASDictionary

ASDictionary, available from the appscript website's [tools page](http://appscript.sourceforge.net/tools.html), provides a convenient GUI interface for exporting application terminology resources in plain text and HTML formats. ASDictionary can export HTML dictionaries in both single-file and frame-based formats.

## Keyword conversion

[caution: keyword conversion rules are not yet finalized, so this might change]

Because application terminology resources specify AppleScript-style keywords for class, property, command, etc. names, NodeAutomation uses the following rules to translate these keywords to legal JS identifiers:

* Characters a-z, A-Z, 0-9 and underscores (`_`) are preserved.

* Spaces, hyphens (`-`) and forward slashes (`/`) are removed, and the following word capitalized (e.g. `document files` → `documentFiles`).

* Ampersands (`&`) are replaced by the word `And`.

* All other characters are converted to 0x00-style hexadecimal representations surrounded by underscores.

* Names that match standard JS value/function names or names already used by NodeAutomation have an underscore appended. 

* If the first character is uppercase, this is currently preserved, e.g. `RGB color` → `RGBColor`. [TO DO: this rule should probably change to match standard JS naming conventions, e.g. `rgbColor`, as linters will complain about a leading uppercase char in a non-class name]

* Names that match the following names [TBC] reserved by nodeautomation have an underscore appended: 

		at                and
		named             or
		ID                not
		previous          customRoot
		next              launch
		slice             isRunning
		thru              property
		where             elements
		first             sendAppleEvent
		middle            help
		last              asType
		any               sendOptions
		every             withTimeout
		beginning         ignoring
		end               toString
		before            valueOf
		after             constructor
		lt                isSpecifier
		le                isKeyword
		eq                fromTypeCode
		ne                fromEnumCode
		gt
		ge
		beginsWith
		endsWith
		contains
		isIn

* NodeAutomation defines default terminology for standard type classes such as `integer` and `UnicodeText`, and standard commands such as `open` and `quit`. If an application-defined name matches a built-in name but has a different Apple event code, NodeAutomation will append an underscore to the application-defined name.
