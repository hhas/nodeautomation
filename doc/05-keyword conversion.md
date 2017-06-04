# Keyword conversion

[TO DO: merge into Type Conversions chapter]

## Keyword conversion

[Note: keyword conversion rules are not yet finalized, so this might change]

Because application terminology resources specify AppleScript-style keywords for class, property, command, etc. names, NodeAutomation uses the following rules to translate these keywords to legal JS identifiers:

* Characters a-z, A-Z, 0-9 and underscores (`_`) are preserved. [TBC]

* Spaces, hyphens (`-`) and forward slashes (`/`) are removed, and the following word capitalized (e.g. `document files` → `documentFiles`). [TBC]

* Ampersands (`&`) are replaced by the word `And`. [TBC]

* All other characters are converted to 0x00-style hexadecimal representations surrounded by underscores. [TBC]

* Names that match standard JS value/function names or names already used by NodeAutomation have an underscore appended. 


[TO DO: include list of reserved names here? or is it okay to leave dictionary viewer to keep users right]

NodeAutomation defines default terminology for standard type classes such as `integer` and `UnicodeText`, and standard commands such as `open` and `quit`. If an application-defined name matches a built-in name but has a different Apple event code, NodeAutomation will append an underscore to the application-defined name.

[TO DO: note that all names are case-sensitive since NodeAutomation relies on case to accurately determine word breaks in names (this is different to AS, where keywords are case-insensitive and use white space to distinguish words within names)]
