'use strict';
// Retire old bookmarks; hospital statistics remain available.
if(location.hash==='#hospital-settings')location.replace('#hospital-records');
window.addEventListener('hashchange',()=>{if(location.hash==='#hospital-settings')location.replace('#hospital-records')});
