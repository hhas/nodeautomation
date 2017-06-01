# Targeted vs untargeted specifiers

While most object specifiers are built using an `app` object that is targeted at a specific application, NodeAutomation also allows you to construct untargeted specifiers that do not refer to a specific application. 

A targeted object specifier begins with an `app` object that identifies the application whose object(s) it refers to, e.g.:

    app('TextEdit').documents.end;

    app.atURL('eppc://my-mac.local/Finder').home.folders.name;


An untargeted specifier begins with `app`, `con` or `its` without indicating the application to which it should eventually be sent, e.g.:

    app.documents.end

    con.words.at(3)

    its.name.beginsWith('d')


Untargeted specifiers provide a convenient shortcut when writing object specifiers that are only used in another object specifier's reference form methods:

    app('Finder').home.folders.where(its.name.beginsWith('d')).get();

    app('Tex-Edit Plus').windows.at(1).text.range(con.words.at(2), 
                                                  con.words.at(-2)).get();


or as command parameters:

    app('TextEdit').make({ new: k.word,
                           at: app.documents[1].words.end, 
                           withData: 'Hello' });

    app('Finder').desktop.duplicate({ 
                  to: app.home.folders.named('Desktop Copy') });

