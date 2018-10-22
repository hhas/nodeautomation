#!/usr/bin/env node

'use strict';

require('nodeautomation/global');

{
    var te = app('TextEdit',{autoRelaunch:k.always}); 

    console.log('launch'); te.activate(); 

    te.quit(); 

    console.log('relaunch'); te.activate();
}
{
    var te = app('TextEdit',{autoRelaunch:k.limited}); 

    console.log('launch'); te.activate(); 

    te.quit(); 

    console.log('relaunch'); te.activate(); // throws as only run()/launch() can auto-relaunch when limited
}
