const CampaignEvents = (() => {
  const option = (label, run, enabled = () => true) => ({label,run,enabled});
  const stock = (key,n) => c => Campaign.add(c,key,n);
  const has = cost => c => Campaign.canPay(c,cost);
  const spend = cost => c => Campaign.pay(c,cost);
  const worker = c => Campaign.free(c)>0;
  const spare = (c,n) => Campaign.beds(c)-c.residents>=n;
  const housing = (c,n) => spare(c,n) || c.queue.some(j=>j.kind==='build'&&j.key==='homes'&&j.day<=c.day+3)
    && Campaign.beds(c)+5-c.residents>=n;
  const reward = (key,n,days,workers,cost={}) => c => Campaign.order(c,'reward',key,days,cost,workers,{amount:n});
  const project = key => c => Campaign.order(c,'clue',key,1,{},1);
  const lostHarvest = key => c => c.effects.push({key,until:c.day+(key==='farm'?1:2)});
  const offer = (title,category,description,eligible,options,settings={}) => ({title,category,description,eligible,options,...settings});
  const roster = {
    '01': offer('Lanterns on the Road','people','Two travelers ask for shelter. They need two beds and add 0.30 provisions per day.',
      c=>housing(c,2),[option('Welcome two refugees',c=>c.residents+=2,c=>spare(c,2))],{limit:2,days:3,easy:true}),
    '02': offer('A Healer’s Bundle','people','A healer offers salve for the injured guardian.',
      c=>Campaign.livingDragon(c)&&c.dragon.health<Campaign.dragonMax(c),
      [option('Accept one salve',stock('salve',1)),option('Give 2 provisions for two salves',c=>{Campaign.pay(c,{food:2});Campaign.add(c,'salve',2);},has({food:2}))],{easy:true}),
    '03': offer('The Spare Sack','people','A neighboring household can spare six grain for the Provisioner.',
      c=>Campaign.levelOf(c,'farm')&&c.stock.food<6*Campaign.rations(c),[option('Accept six grain',stock('grain',6))],{easy:true}),
    '04': offer('A Shepherd at the Gate','people','A shepherd offers to settle with two livestock. One bed and 0.15 provisions per day are needed.',
      c=>Campaign.levelOf(c,'pasture')&&housing(c,1),
      [option('Welcome the shepherd',c=>{c.residents++;Campaign.add(c,'livestock',2);},c=>spare(c,1))],{easy:true}),
    '05': offer('The Traveler’s Seal','people','A traveler carries a copy of the old gate seal and remembers the east road.',
      c=>c.journal.includes(2),[option('Record the account in the journal',c=>c.journal.push('seal')),
        option('File the account for later',c=>c.journal.push('seal'))],{easy:true}),
    '06': offer('A Visitor at the Altar','people','A visitor lays a wrapped bundle on the Altar. You can inspect it and review the ordinary summoning terms.',
      c=>Campaign.canSummon(c),[option('Inspect the bundle and open the Altar',()=>{},Campaign.canSummon)],{pane:'altar',easy:true}),
    '07': offer('Timber After the Storm','land','A fallen tree can provide eight timber. One worker would be away for two days.',
      c=>Campaign.levelOf(c,'wood')&&worker(c),
      [option('Send one worker for two days',reward('timber',8,2,1),worker)],{limit:2,easy:true}),
    '08': offer('The Old Quarry Face','land','A newly exposed seam will yield six stone tomorrow if the supports can be braced.',
      c=>Campaign.levelOf(c,'quarry')&&has({timber:2})(c),
      [option('Use 2 timber to brace the seam',reward('stone',6,1,0,{timber:2}),has({timber:2}))],{limit:2,easy:true}),
    '09': offer('Herbs Under the Wall','land','Send one worker for a day to gather four herbs.',
      worker,[option('Send one worker to gather herbs',reward('herbs',4,1,1),worker)],{limit:2,easy:true}),
    '10': offer('A Cart in the Ford','land','Recovering the cart takes two days, one worker, and two provisions. Its tools yield two equipment.',
      c=>c.level>=3&&worker(c)&&c.stock.food>=2+4*Campaign.rations(c),
      [option('Recover the cart',reward('equipment',2,2,1,{food:2}),c=>worker(c)&&c.stock.food>=2+4*Campaign.rations(c))]),
    '11': offer('Rain at the Granary','land','The roof is leaking. Up to six grain above the emergency reserve can be lost.',
      c=>c.stock.grain>=6+6*Campaign.rations(c)&&(worker(c)||has({timber:2})(c)),
      [option('Patch the roof with 2 timber',spend({timber:2}),has({timber:2})),option('Send one worker for a day',c=>Campaign.order(c,'demobilize','granary',1,{},1),worker)],
      {limit:2,days:1,miss:c=>{c.stock.grain-=Math.max(0,Math.min(6,c.stock.grain-6*Campaign.rations(c)));}}),
    '12': offer('The Slipped Track','land','A washout could halve production at the woodcutters or quarry for two days.',
      c=>Campaign.levelOf(c,'wood')&&Campaign.levelOf(c,'quarry')&&c.stock.timber>=8&&c.stock.stone>=8,
      [option('Brace the track with 2 timber',spend({timber:2}),has({timber:2})),option('Send one worker for a day',c=>Campaign.order(c,'demobilize','track',1,{},1),worker)],
      {miss:(c,e)=>lostHarvest(e.target)(c),target:c=>Campaign.random(c.seed^0x5af4,c.eventDraws)<.5?'wood':'quarry'}),
    '13': offer('Frost Before Dawn','land','The next grain harvest could fall by half. One worker can cover the crop.',
      c=>Campaign.levelOf(c,'farm')&&worker(c)&&c.stock.food>=2*Campaign.rations(c),
      [option('Send a worker to cover the crop',c=>Campaign.order(c,'demobilize','farm',1,{},1),worker)],{days:1,miss:lostHarvest('farm')}),
    '14': offer('A Quiet Roost','dragon','The wounded guardian can recover four health if the village gives it a day of quiet.',
      c=>Campaign.livingDragon(c)&&c.dragon.health<Campaign.dragonMax(c)&&Campaign.nextAttack(c)-c.day>=2,
      [option('Grant a day of rest',c=>{c.dragon.health=Math.min(Campaign.dragonMax(c),c.dragon.health+4);c.effects.push({key:'scout',until:c.day+1});},
        c=>Campaign.livingDragon(c)&&Campaign.nextAttack(c)-c.day>=2)]),
    '15': offer('Shadow Across the Pass','dragon','A scout saw a wingtip over the ridge. Send one worker for a day to verify the sighting.',
      c=>c.level>=3&&worker(c),[option('Verify the sighting',project('shadow'),worker)]),
    '16': offer('Lamps Along the Ridge','dragon','A watch light has gone dark at a weak sector. Inspect it to save two timber on one fortification repair.',
      c=>c.level===4&&c.invasionAt!==null&&c.invasionAt-c.day>=4&&worker(c)
        && Object.keys(Campaign.buildings).some(k=>['wall','tower','ballista','bastion'].includes(k)&&c.buildings[k].level&&c.buildings[k].health<100),
      [option('Inspect the weak sector',project('lamps'),worker)])
  };

  function close(c, result) {
    const event=c.event;
    c.eventHistory.push({id:event.id,day:c.day,offered:event.offered,result});
    Campaign.record(c,`${roster[event.id].title} · ${result}.`);
    c.event=null;
  }
  function dismiss(c) {
    if(!c.event)return false;
    const def=roster[c.event.id];
    def.miss?.(c,c.event);
    close(c,def.miss?'Unmitigated':'Passed');
    return true;
  }
  function choose(c, key) {
    if(key==='pass')return dismiss(c);
    if(!c.event)return false;
    const def=roster[c.event.id];
    const selected=def.options[Number(key)];
    if(!selected?.enabled(c))return false;
    selected.run(c);
    close(c,selected.label);
    return true;
  }
  function tick(c, blocked) {
    c.effects=c.effects.filter(e=>e.until>=c.day);
    if(c.event?.due<=c.day)dismiss(c);
    if(c.event||blocked||c.demand||c.departure||c.day<c.eventAt||Campaign.nextAttack(c)-c.day<=3)return false;
    c.eventAt=c.day+5;
    const last=c.eventHistory.at(-1);
    if(last&&c.day-last.offered<6)return false;
    const random=()=>Campaign.random(c.seed^0x569a81e3,c.eventDraws++);
    if(random()>=.5)return false;
    const ids=Object.keys(roster).filter(id=>{
      const e=roster[id];
      if(c.invasionAt!==null&&id!=='16'||c.invasionAt===null&&id==='16'||!last&&!e.easy||!e.eligible(c))return false;
      if(c.eventHistory.filter(h=>h.id===id).length>=(e.limit??1))return false;
      return !c.eventHistory.some(h=>roster[h.id]?.category===e.category&&c.day-h.offered<10);
    });
    if(!ids.length)return false;
    const id=ids[Math.floor(random()*ids.length)];
    const e=roster[id];
    c.event={id,offered:c.day,due:c.day+(e.days??2),target:e.target?.(c)??null};
    Campaign.record(c,`Encounter: ${e.title}.`);
    return true;
  }
  function canRecover(c) {
    return ['01','04'].includes(c.event?.id)&&spare(c,c.event.id==='01'?2:1);
  }
  return { roster, tick, choose, canRecover };
})();
