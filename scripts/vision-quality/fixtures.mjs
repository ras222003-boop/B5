/** Original schematic scenes authored for this repository. No third-party photos or rights. */
const object=(type,x,y,scale=1,color='#64748b')=>({type,x,y,scale,color});
export const fixtures=[
  {id:'01-living-room',kind:'multi-furniture room',objects:[object('sofa',150,520,2,'#a16207'),object('table',560,650,1.5,'#78350f'),object('chair',920,520,1.4,'#92400e'),object('lamp',1070,350,1)],reference:'أريكة يسار الصورة، طاولة أمامها، كرسي يمينها ومصباح خلف الكرسي.'},
  {id:'02-small-tools',kind:'small tabletop tools',objects:[object('table',220,540,5,'#6b4f3a'),object('laptop',340,500,1.6),object('cup',650,570,0.8,'#f8fafc'),object('phone',770,580,0.65,'#1e293b'),object('pen',920,580,0.7,'#b91c1c')],reference:'طاولة عليها حاسوب محمول يسارًا، كوب قرب الوسط، هاتف وقلم صغيران يمينًا.'},
  {id:'03-overlap',kind:'overlapping people and objects',objects:[object('chair',430,530,1.8),object('person',470,390,1.9,'#1d4ed8'),object('bag',650,620,1,'#dc2626'),object('person',700,410,1.5,'#16a34a')],reference:'شخصان متداخلان جزئيًا مع كرسي؛ حقيبة حمراء على الأرض إلى يمينهما. لا تظهر الهوية.'},
  {id:'04-hallway',kind:'doors and corridor',objects:[object('door',110,310,2,'#78350f'),object('door',940,330,1.6,'#7c2d12'),object('box',570,700,0.9,'#b45309')],reference:'ممر ذو باب يسارًا وباب يمينًا، وصندوق على الأرض قرب الوسط.'},
  {id:'05-dark-bedroom',kind:'low light',dark:0.64,objects:[object('bed',140,530,2.5,'#334155'),object('lamp',800,400,1,'#facc15'),object('bag',900,690,0.7)],reference:'غرفة مظلمة؛ سرير يسارًا ومصباح مضاء يمينًا، جسم صغير على الأرض قد لا يتضح.'},
  {id:'06-exit-arabic',kind:'Arabic sign',objects:[object('door',440,340,2,'#78350f')],texts:[{value:'مخرج',x:550,y:300,size:56}],reference:'لوحة عربية مكتوب عليها «مخرج» فوق باب في الوسط.'},
  {id:'07-room-number',kind:'Arabic numerals',objects:[object('door',420,340,2,'#78350f')],texts:[{value:'غرفة ١٢٣',x:520,y:280,size:43}],reference:'لوحة «غرفة ١٢٣» فوق باب. يجب نقل الرقم كما هو دون تخمين.'},
  {id:'08-blurry-kitchen',kind:'blurred scene',blur:3,objects:[object('fridge',110,370,1.8,'#e2e8f0'),object('table',480,610,2.4),object('cup',740,565,0.8)],reference:'ثلاجة على اليسار وطاولة في الوسط؛ كوب صغير غير واضح بسبب التشوش.'},
  {id:'09-cropped-shelf',kind:'cropped objects',crop:true,objects:[object('shelf',950,400,2),object('box',1010,540,0.6),object('chair',280,640,1.3)],reference:'رف مقطوع عند الحافة اليمنى وكرسي يسار الصورة؛ لا يمكن وصف ما خارج الإطار.'},
  {id:'10-office',kind:'office furniture',objects:[object('table',300,620,3.2,'#78350f'),object('monitor',490,475,1.4,'#1e293b'),object('chair',820,610,1.6,'#475569'),object('plant',1000,515,1.1,'#15803d')],reference:'مكتب عليه شاشة، كرسي يمينه، ونبات في أقصى اليمين.'},
  {id:'11-bathroom',kind:'bathroom',objects:[object('sink',480,490,2,'#e2e8f0'),object('door',100,330,1.8),object('lamp',920,260,0.8)],reference:'حوض في الوسط، باب يسارًا، ومصباح أعلى اليمين.'},
  {id:'12-classroom',kind:'Arabic classroom board',objects:[object('table',230,650,1.7),object('table',710,650,1.7),object('chair',380,680,0.9),object('chair',850,680,0.9)],texts:[{value:'الرياضيات',x:590,y:320,size:49}],reference:'سبورة مكتوب عليها «الرياضيات» وطاولتان وكرسيان أسفلها.'},
  {id:'13-market-price',kind:'small Arabic price',objects:[object('shelf',270,370,2.4),object('box',450,500,0.7),object('box',610,500,0.7)],texts:[{value:'١٥ ريال',x:550,y:440,size:27}],reference:'رف وبضائع؛ ملصق سعر صغير يقرأ «١٥ ريال» قرب الوسط.'},
  {id:'14-entrance-floor',kind:'visible floor condition',objects:[object('door',480,280,2.3),object('box',300,720,0.7),object('cable',740,790,1.6,'#111827')],reference:'باب في الوسط، صندوق يسار الأرضية وكابل داكن ممتد يمين الأرضية؛ لا يمكن تأكيد سلامة العبور.'},
  {id:'15-outdoor',kind:'outdoor objects',outdoor:true,objects:[object('chair',200,600,2,'#6b4f3a'),object('bicycle',620,600,2),object('person',1030,430,1.7,'#2563eb')],reference:'مشهد خارجي، مقعد يسارًا ودراجة في الوسط وشخص يمينًا.'},
  {id:'16-living-details',kind:'colors and small details',objects:[object('sofa',150,540,2,'#1d4ed8'),object('plant',850,470,1.5,'#15803d'),object('book',400,600,0.8,'#dc2626'),object('phone',340,630,0.5,'#0f172a')],reference:'أريكة زرقاء يسارًا، نبات أخضر يمينًا، كتاب أحمر وهاتف صغير على الأريكة.'},
  {id:'17-crowded-table',kind:'dense small tools',objects:[object('table',180,570,5,'#92400e'),object('book',300,580,1.2,'#f97316'),object('scissors',520,595,0.9),object('keys',700,610,0.65),object('cup',900,600,0.8,'#e5e7eb')],reference:'طاولة مزدحمة عليها دفتر برتقالي يسارًا، مقص ومفاتيح صغيرة وسطًا، وكوب يمينًا.'},
  {id:'18-stairs',kind:'vertical spatial relation',objects:[object('stairs',310,440,3,'#94a3b8'),object('box',900,760,1.0,'#b45309')],reference:'درجات سلم في يسار الصورة، وصندوق على الأرض إلى اليمين.'},
  {id:'19-dim-corridor',kind:'dim and partial',dark:0.45,objects:[object('door',80,330,1.7),object('cable',480,790,2,'#111827'),object('box',1040,720,0.8)],reference:'ممر معتم قليلًا؛ باب يسارًا، كابل على الأرض في الوسط، وصندوق عند الحافة اليمنى.'},
  {id:'20-ambiguous',kind:'ambiguous silhouette',blur:7,dark:0.36,objects:[object('person',640,410,1.4,'#334155'),object('bag',740,690,0.7,'#334155')],reference:'هيئة شخص أو جسم قائم غير حاسم بسبب التشوش والإضاءة؛ جسم صغير أسفله غير واضح. يجب التصريح بعدم اليقين.'},
];

const escape=(s)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function shape(o){
  const {type,x,y,scale:s,color:c}=o;
  const parts={
    sofa:`<rect x="0" y="30" width="150" height="60" rx="15" fill="${c}"/><rect x="10" y="5" width="130" height="50" rx="14" fill="${c}"/><rect x="8" y="85" width="12" height="16" fill="#292524"/><rect x="130" y="85" width="12" height="16" fill="#292524"/>`,
    table:`<rect x="0" y="20" width="140" height="22" rx="3" fill="${c}"/><rect x="15" y="42" width="12" height="65" fill="${c}"/><rect x="112" y="42" width="12" height="65" fill="${c}"/>`,
    chair:`<rect x="10" y="0" width="70" height="65" rx="8" fill="${c}"/><rect x="0" y="60" width="90" height="20" fill="${c}"/><path d="M12 80v28 M75 80v28" stroke="#292524" stroke-width="9"/>`,
    person:`<circle cx="50" cy="17" r="17" fill="#b98d69"/><path d="M25 45q25 -12 50 0v45H25z" fill="${c}"/><path d="M35 90l-10 65 M65 90l10 65 M25 55L5 100 M75 55l20 45" stroke="${c}" stroke-width="14" fill="none"/>`,
    bag:`<rect x="10" y="25" width="75" height="70" rx="8" fill="${c}"/><path d="M30 30V15q18 -15 35 0v15" fill="none" stroke="${c}" stroke-width="7"/>`,
    door:`<rect x="0" y="0" width="90" height="160" fill="#f4e4c7" stroke="#443322" stroke-width="7"/><rect x="8" y="8" width="74" height="150" fill="${c}"/><circle cx="66" cy="90" r="5" fill="#fde68a"/>`,
    box:`<rect x="5" y="25" width="90" height="70" fill="${c}" stroke="#78350f" stroke-width="4"/><path d="M5 25l45 -20 45 20M50 5v90" fill="none" stroke="#fbbf24" stroke-width="4"/>`,
    lamp:`<path d="M40 45v100 M10 145h60" stroke="#52525b" stroke-width="7"/><path d="M10 45L25 5h30l15 40z" fill="${c}"/>`,
    laptop:`<rect x="5" y="0" width="110" height="70" rx="4" fill="#1e293b" stroke="#64748b" stroke-width="5"/><path d="M0 75h125l-8 12H8z" fill="#94a3b8"/>`,
    cup:`<path d="M10 15h55l-5 70H16z" fill="${c}" stroke="#475569" stroke-width="3"/><path d="M65 25q40 -8 12 35l-15 4" fill="none" stroke="#475569" stroke-width="5"/>`,
    phone:`<rect x="10" y="0" width="50" height="92" rx="6" fill="${c}" stroke="#94a3b8" stroke-width="4"/><circle cx="35" cy="80" r="3" fill="#e2e8f0"/>`,
    pen:`<path d="M0 65L115 20" stroke="${c}" stroke-width="8"/><path d="M0 65l14 -2" stroke="#111827" stroke-width="4"/>`,
    fridge:`<rect x="5" y="0" width="85" height="160" rx="5" fill="${c}" stroke="#64748b" stroke-width="5"/><path d="M5 65h85M75 25v25M75 95v35" stroke="#64748b" stroke-width="5"/>`,
    shelf:`<path d="M5 0v150 M95 0v150 M5 50h90 M5 100h90 M5 150h90" stroke="${c}" stroke-width="10" fill="none"/><rect x="20" y="15" width="25" height="30" fill="#b45309"/><rect x="55" y="63" width="30" height="30" fill="#dc2626"/>`,
    monitor:`<rect x="5" y="0" width="120" height="75" rx="3" fill="${c}" stroke="#94a3b8" stroke-width="5"/><path d="M65 75v25 M35 100h60" stroke="#475569" stroke-width="8"/>`,
    plant:`<path d="M20 80h65l-12 60H32z" fill="#92400e"/><path d="M50 90V20" stroke="#166534" stroke-width="5"/><ellipse cx="25" cy="36" rx="27" ry="13" transform="rotate(-30 25 36)" fill="${c}"/><ellipse cx="74" cy="48" rx="27" ry="13" transform="rotate(30 74 48)" fill="${c}"/>`,
    sink:`<ellipse cx="65" cy="55" rx="60" ry="28" fill="${c}" stroke="#64748b" stroke-width="5"/><path d="M30 65l10 90h50l10 -90" fill="${c}" stroke="#64748b" stroke-width="4"/><path d="M65 30V5h30" stroke="#64748b" stroke-width="7" fill="none"/>`,
    bed:`<rect x="0" y="25" width="170" height="75" rx="10" fill="${c}"/><rect x="5" y="32" width="50" height="35" rx="8" fill="#e2e8f0"/><rect x="10" y="100" width="12" height="15" fill="#292524"/><rect x="145" y="100" width="12" height="15" fill="#292524"/>`,
    bicycle:`<circle cx="30" cy="85" r="27" fill="none" stroke="${c}" stroke-width="7"/><circle cx="120" cy="85" r="27" fill="none" stroke="${c}" stroke-width="7"/><path d="M30 85l45 -55 45 55H30l35 -55m35 -15h25" stroke="${c}" stroke-width="6" fill="none"/>`,
    book:`<rect x="0" y="10" width="90" height="65" fill="${c}" stroke="#f8fafc" stroke-width="4"/><path d="M45 10v65" stroke="#f8fafc" stroke-width="3"/>`,
    scissors:`<circle cx="22" cy="70" r="15" fill="none" stroke="${c}" stroke-width="5"/><circle cx="65" cy="70" r="15" fill="none" stroke="${c}" stroke-width="5"/><path d="M30 60L85 10M55 60L5 10" stroke="#9ca3af" stroke-width="5"/>`,
    keys:`<circle cx="25" cy="25" r="17" fill="none" stroke="${c}" stroke-width="7"/><path d="M37 37l55 55m-10 -10l12 -12m-23 3l12 -12" stroke="${c}" stroke-width="7"/>`,
    cable:`<path d="M0 35q40 -45 80 0t80 0t80 0" fill="none" stroke="${c}" stroke-width="8"/>`,
    stairs:`<path d="M0 120h45V90h45V60h45V30h45V0h45" fill="none" stroke="${c}" stroke-width="18"/>`,
  };
  return `<g transform="translate(${x} ${y}) scale(${s})">${parts[type]}</g>`;
}

export function fixtureSvg(fixture){
  const text=(fixture.texts??[]).map(t=>`<rect x="${t.x-135}" y="${t.y-t.size}" width="270" height="${t.size+22}" rx="5" fill="#fef3c7" stroke="#78350f"/><text x="${t.x}" y="${t.y}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${t.size}" fill="#111827" direction="rtl">${escape(t.value)}</text>`).join('');
  const dark=fixture.dark?`<rect width="1280" height="960" fill="#090d18" opacity="${fixture.dark}"/>`:'';
  const content=`<rect width="1280" height="960" fill="${fixture.outdoor?'#b9e3f9':'#e8dfcf'}"/><path d="M0 680h1280v280H0z" fill="${fixture.outdoor?'#659d68':'#b7a895'}"/><path d="M0 680l640 220 640 -220" fill="none" stroke="#9c8b76" stroke-width="4"/>${fixture.objects.map(shape).join('')}${text}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${fixture.crop?1120:1280}" height="960" viewBox="${fixture.crop?'160 0 1120 960':'0 0 1280 960'}"><defs><filter id="soft"><feGaussianBlur stdDeviation="${fixture.blur??0}"/></filter></defs><g filter="url(#soft)">${content}</g>${dark}</svg>`;
}
