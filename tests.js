#!/usr/bin/env node

'use strict';

const na = require('./lib');

const app = na.app, con = na.con, its = na.its, k = na.k, File = na.File;

// TO DO: autorelease pools not yet implemented in NodeAutomation, so will leak unless user provides their own


/****************************************************************************************/
// TEST

/*

var appData = new aeappdata.AppData("bob", [], []);

console.log(aesupport.formatFourCharCode(appData.pack(k.fromTypeCode(1234))('descriptorType')));


var appData = new aeappdata.AppData("bob", [], []);

var v = [null, true, 4,'3b', new Date('2016/1/1 13:04')];

var v = {name:"bob", 'class':new aesupport.Keyword('document'), $age:33};

var desc = appData.pack(v);

console.log(desc);

console.log(`<${util.inspect(v)}>`);
console.log(`<${util.inspect(appData.unpack(desc))}>`);

*/

const f = app('Finder');

/*
try {
console.log(f.home, f.home.items[1000]());
} catch (e) {
    console.log(e.toString(), '\n');
}

console.log(f.home.items.name());
console.log(f.FinderWindows[0].bounds());
console.log(f.FinderWindows[0].iconViewOptions.backgroundColor());
*/


//const finderProc = app("System Events").processes.named("Finder");
//var res = finderProc.windows.at(1).UIElements.where(its.position.equalTo([478, 26])).get();
//console.log(res);



// TEST.ID(2345).document.text.words // .slice(66, 88)

const te = app('TextEdit'); // {terminology: '/Users/has/TextEdit.node.json'});

te.activate();

//console.log(te.documents.next());

//console.log(app.documents.next());

/*

console.log(te.isRunning);

te.launch();

console.log(te.isRunning);
*/

//util.inspect(te);

var objspec = te.windows.named('ABC').characters.thru(1,4).text;

var ref = te.documents.text;
//console.log('REF:', ref);
//console.log('OBJSPEC:', te.__nodeautomation_appData__.pack(ref));

//console.log(app.documents.text.any);

//console.log(con.words[2].previous());
//console.log(con.words[2].previous(k.character));

console.log("RESULT:", ref.get());

if (te.documents.count() === 0) { te.make({new:k.document}); }

te.documents.at(1).text.set({to:"Hello, World!\n"});

var objspec = te.documents.where(its.name.beginsWith('Untitled').and(its.text.notEqualTo('')));
console.log("RESULT2:", objspec.get());

te.documents[0].text.paragraphs.end.make({new:k.paragraph, withData:"this is make\n"});

te.documents.at(1).close({saving:k.ask});
//var objspec = its.words.ID(344).lessOrEqual('Untitled').and(its.name.notEqualTo('Bob'));

//console.log(objspec.__nodeautomation_specifierRecord__);

/*
*/

/*


//var aedesc = objspec.__nodeautomation_pack__(te.__nodeautomation_appData__);//.at(1);
//console.log('\n\nOBSPEC', objspec.toString());
//console.log('\nAEDESC', aedesc.toString());

//console.log(k, k.name, k.fromTypeCode(0x001234EF));


*/
