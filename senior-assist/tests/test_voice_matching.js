// Voice-matching tests (accents, Hindi/Telugu words, spoken digits). Run: node tests/test_voice_matching.js
global.window = { addEventListener(){} }; global.document = { body: { dataset: { userId: "1", lang: "en" } }, querySelector: () => null }; global.navigator = {};
const fs = require("fs"); const path = require("path"); const dir = path.join(__dirname, "..", "static", "js");
eval(fs.readFileSync(dir+'/i18n.js','utf8') + fs.readFileSync(dir+'/core.js','utf8') + `
const cats = ['electricity','water','mobile'].map(k=>({value:k,label:k,words:VOCAB['cat_'+k]}));
const cities = CITY_LIST.map(c=>({value:c.id,label:c.en,words:[c.en,c.hi,c.te,...c.words]}));
const seats = [{value:'lower',label:'Lower',words:VOCAB.seat_lower},{value:'any',label:'Any',words:VOCAB.seat_any}];
const cases = [
 ['option', cats, ['कर्रेंट బిల్లు'], 'electricity'], ['option', cats, ['bijli ka bill'], 'electricity'],
 ['option', cats, ['నీళ్ళ బిల్లు కట్టాలి'], 'water'], ['option', cats, ['मोबाइल रिचार्ज'], 'mobile'],
 ['option', cities, ['hydrabad'], 'hyderabad'], ['option', cities, ['తిరుపతికి వెళ్ళాలి'], 'tirupati'],
 ['option', cities, ['vizag'], 'visakhapatnam'], ['option', cities, ['बैंगलोर जाना है'], 'bengaluru'],
 ['option', cities, ['banglore'], 'bengaluru'],
 ['option', seats, ['నాకు కింది సీటు'], 'lower'], ['option', seats, ['second one'], 'any'],
 ['yesNo', null, ['హా అవును'], 'yes'], ['yesNo', null, ['नहीं'], 'no'], ['yesNo', null, ['haan ji'], 'yes'], ['yesNo', null, ['వద్దు'], 'no'],
 ['digits', null, ['nine eight seven six five four three two one zero'], '9876543210'],
 ['digits', null, ['98765 43210'], '9876543210'], ['digits', null, ['double five six seven'], '55 67'.replace(' ','')],
 ['digits', null, ['ఒకటి రెండు మూడు నాలుగు ఐదు ఆరు'], '123456'], ['digits', null, ['नौ आठ सात छह'], '9876'],
 ['command', null, ['వెనక్కి'], 'back'], ['command', null, ['फिर से'], 'repeat'], ['command', null, ['go back to tirupati please now'], null],
];
let pass=0;
for (const [fn, opts, alts, want] of cases) {
  let got = fn==='option' ? (Match.option(alts, opts)||{}).value ?? null : fn==='digits' ? Match.digits(alts)[0] : Match[fn](alts);
  const ok = got===want; pass+=ok;
  if(!ok) console.log('FAIL', fn, alts[0], '→', got, 'want', want);
}
console.log(pass+'/'+cases.length+' passed');
`);
