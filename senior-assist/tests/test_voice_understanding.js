// Tests for "read only one option", one-by-one, smart picks and "did you mean".
// Run: node tests/test_voice_understanding.js
global.window = { addEventListener() {} };
global.document = { body: { dataset: { userId: '1', lang: 'en' } }, querySelector: () => null };
global.navigator = {};
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'static', 'js');
eval(fs.readFileSync(path.join(dir, 'i18n.js'), 'utf8') + fs.readFileSync(path.join(dir, 'core.js'), 'utf8') + `
const trains = [
  { value: 0, label: 'Godavari Superfast', words: ['Godavari Superfast', 'option 1'], meta: { fare: 470, hours: 10.6, hour: 6 } },
  { value: 1, label: 'Deccan Express', words: ['Deccan Express', 'option 2'], meta: { fare: 355, hours: 9.4, hour: 14 } },
  { value: 2, label: 'Konark Mail', words: ['Konark Mail', 'option 3'], meta: { fare: 410, hours: 11.2, hour: 21 } },
];
const cats = ['electricity', 'water', 'mobile'].map(k => ({ value: k, label: k, words: VOCAB['cat_' + k] }));
let pass = 0, total = 0;
const check = (name, got, want) => { total++; if (JSON.stringify(got) === JSON.stringify(want)) pass++; else console.log('FAIL', name, '→', got, 'want', want); };

// --- read ONLY one option (does not choose it)
check('read option 2 (en)', Match.readRequest(['read option 2'], trains), 1);
check('tell me the third one', Match.readRequest(['tell me the third one'], trains), 2);
check('what is option one', Match.readRequest(['what is option one'], trains), 0);
check('repeat option two', Match.readRequest(['repeat option two'], trains), 1);
check('hi: दूसरा विकल्प बताओ', Match.readRequest(['दूसरा विकल्प बताओ'], trains), 1);
check('hi: तीसरा पढ़ो', Match.readRequest(['तीसरा पढ़ो'], trains), 2);
check('te: రెండో ఎంపిక చెప్పండి', Match.readRequest(['రెండో ఎంపిక చెప్పండి'], trains), 1);
check('te: మొదటిది చదవండి', Match.readRequest(['మొదటి ఎంపిక చదవండి'], trains), 0);
check('read by name: tell me about Konark Mail', Match.readRequest(['tell me about konark mail'], trains), 2);
check('plain "option 2" is a choice, not a read', Match.readRequest(['option 2'], trains), -1);
check('"repeat option two" is not the global repeat command', Match.command(['repeat option two']), null);
check('plain "repeat" still is', Match.command(['repeat']), 'repeat');

// --- one by one / next
check('one by one', Match.wantsOneByOne(['read them one by one']), true);
check('hi: एक-एक करके', Match.wantsOneByOne(['एक-एक करके बताओ']), true);
check('te: ఒక్కొక్కటిగా', Match.wantsOneByOne(['ఒక్కొక్కటిగా చెప్పండి']), true);
check('next', Match.wantsNext(['next']), true);
check('te: తర్వాత', Match.wantsNext(['తర్వాత']), true);
check('hi: अगला', Match.wantsNext(['अगला']), true);

// --- smart picks
check('cheapest', Match.smartPick(['the cheapest one'], trains), { index: 1, kind: 'cheapest' });
check('hi: सबसे सस्ता', Match.smartPick(['सबसे सस्ता वाला'], trains), { index: 1, kind: 'cheapest' });
check('te: తక్కువ ధర', Match.smartPick(['తక్కువ ధర ఉన్నది'], trains), { index: 1, kind: 'cheapest' });
check('fastest', Match.smartPick(['the fastest train'], trains), { index: 1, kind: 'fastest' });
check('morning', Match.smartPick(['morning train'], trains), { index: 0, kind: 'morning' });
check('te: సాయంత్రం (none in list)', Match.smartPick(['సాయంత్రం బండి'], trains), { index: -1, kind: 'evening' });
check('hi: रात वाली', Match.smartPick(['रात वाली गाड़ी'], trains), { index: 2, kind: 'night' });
check('last one', Match.smartPick(['the last one'], trains), { index: 2, kind: 'last' });
check('no meta → no smart pick', Match.smartPick(['cheapest'], cats), null);

// --- clear vs unsure answers
check('strong: water', Match.optionScored(['water bill'], cats).strength, 'strong');
check('strong: ordinal', Match.optionScored(['second'], cats).index, 1);
check('"watter" sounds exactly like water → chosen', Match.optionScored(['watter'], cats).strength, 'strong');
check('weak: "wotr" (only close) → ask "did you mean"', Match.optionScored(['wotr'], cats), { option: cats[1], index: 1, strength: 'weak' });

// --- sound-alike matching across scripts (option words only in English!)
const en = (...labels) => labels.map((l, i) => ({ value: i, label: l, words: [] }));
const bills = en('Electricity', 'Water', 'Mobile');
check('te: ఎలక్ట్రిసిటీ బిల్లు → Electricity', Match.optionScored(['ఎలక్ట్రిసిటీ బిల్లు'], bills).index, 0);
check('hi: वाटर बिल → Water', Match.optionScored(['वाटर बिल'], bills).index, 1);
check('te: మొబైల్ → Mobile', Match.optionScored(['మొబైల్'], bills).index, 2);
check('hi: मोबाइल → Mobile', Match.optionScored(['मोबाइल रिचार्ज'], bills).index, 2);
const towns = en('Hyderabad', 'Tirupati', 'Visakhapatnam', 'Bengaluru', 'Chennai');
check('te: తిరుపతి వెళ్ళాలి → Tirupati', Match.optionScored(['తిరుపతి వెళ్ళాలి'], towns).index, 1);
check('hi: हैदराबाद से → Hyderabad', Match.optionScored(['हैदराबाद से'], towns).index, 0);
check('"tirupathi" spelling → Tirupati', Match.optionScored(['tirupathi'], towns).index, 1);
check('te: చెన్నై → Chennai', Match.optionScored(['చెన్నై'], towns).index, 4);
check('hi: बेंगलुरु → Bengaluru', Match.optionScored(['बेंगलुरु'], towns).index, 3);
check('te: విశాఖపట్నం → Visakhapatnam', Match.optionScored(['విశాఖపట్నం'], towns).index, 2);
const people = en('Ravi', 'Priya', 'Arjun');
check('te: రవికి కాల్ → Ravi', (Match.optionScored(['రవికి కాల్ చేయండి'], people) || {}).index, 0);
check('hi: प्रिया को फोन → Priya', Match.optionScored(['प्रिया को फोन करो'], people).index, 1);
// --- must NOT match unrelated words
check('no false match: "hello how are you"', Match.optionScored(['hello how are you'], bills), null);
check('no false match: "the weather is nice"', Match.optionScored(['the weather is nice today'], towns), null);
check('no false match: "bus"', Match.optionScored(['bus'], bills), null);
// --- transliteration itself
check('roman: కరెంట్', Translit.roman('కరెంట్'), 'karent');
check('roman: बिल (Hindi final a dropped)', Translit.roman('बिल'), 'bil');
check('key: current ≈ కరెంట్', Translit.soundsLike('current', 'కరెంట్') > 0, true);
check('nothing', Match.optionScored(['banana'], cats), null);
check('8-item list: "fifth"', Match.ordinal(['the fifth one'], 8), 4);

console.log(pass + '/' + total + ' passed');
if (pass !== total) process.exitCode = 1;
`);
