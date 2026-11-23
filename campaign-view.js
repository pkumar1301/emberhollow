const CampaignView = (() => {
  const names={town:'Town Center',economy:'Economy',army:'Army',dragon:'Guardian',altar:'Altar',threat:'Valley watch',
    encounters:'Encounters',journal:'Journal',records:'Battle reports',checkpoints:'Checkpoints'};
  const fmtCampaign = n => Number.isFinite(n)?Number(n.toFixed(1)).toString():'—';
  const b=(verb,key,label,disabled=false)=>button(`campaign:${verb}:${key}`,label,disabled);
  const card=(label,content)=>`<section class="campaign-card"><h3>${label}</h3>${content}</section>`;
  const count=(title,value)=>row(title,typeof value==='number'?fmtCampaign(value):value);
  const due=(c,kind,key)=>c.queue.find(o=>o.kind===kind&&o.key===key)?.day;
  const queuedText=(c,kind,key)=>due(c,kind,key)?`<small>Ready on Day ${due(c,kind,key)}</small>`:'';
  const money=cost=>Campaign.labelCost(cost);
  const disabled=c=>!Campaign.active(c);
  const panels={
    town(c){
      const requirements=Campaign.requirements(c);
      const next=due(c,'advance','hall');
      const advancing=requirements.length?card(`Advance to Level ${c.level+1}`,next?count('Completes',`Day ${next}`):
        `<ul class="campaign-requirements">${requirements.map(([label,met])=>`<li>${met?'Ready':'Needed'} · ${label}</li>`).join('')}</ul>`
        +(c.level===3?`<p>Reaching Level 4 starts the 48-day invasion countdown. Review the defense before committing.</p>${count('Current army power',Campaign.armyPower(c))}`:'')
        +b('advance','',`Confirm Level ${c.level+1} advancement`,!Campaign.canAdvance(c))):'';
      return count('Village',escapeText(village.villageName))+count('Village level',c.level)+count('Town Center health',c.buildings.hall.health)
        +count('Residents / beds',`${c.residents} / ${Campaign.beds(c)}`)+count('Available workers',Campaign.free(c))
        +b('recruit','homes','Recruit resident · 6 provisions · 3 timber',!Campaign.canRecruit(c))+queuedText(c,'recruit','homes')
        +advancing+card('Construction', ['hall','homes','granary','warehouse'].map(key=>build(c,key)).join(''))+b('pane','checkpoints','View checkpoints');
    },
    economy(c){
      const store=Object.keys(Campaign.resources).filter(k=>['grain','food','timber','stone','livestock','herbs','salve'].includes(k)||c.level>=3);
      return card('Stocks',store.map(k=>count(Campaign.resources[k],`${fmtCampaign(c.stock[k])} / ${Campaign.storage(c,k)}`)).join('')
        +count('Daily provisions required',Campaign.rations(c))+count('Consecutive missed ration days',c.shortage))
        +Object.entries(Campaign.jobs).filter(([,j])=>j[1]<=c.level).map(([key,[label,,site,,rate]])=>{
          const level=Campaign.levelOf(c,site);
          const cap=(key==='farmers'?3:2)+Math.max(0,level-1)*2;
          return card(Campaign.buildings[site][0],count(label,`${c.jobs[key]} / ${cap}`)
            +count('Output per worker before inputs or damage',rate)
            +`<div class="actions">${b('unassign',key,`Unassign ${label.toLowerCase()}`,!c.jobs[key]||disabled(c))}
              ${b('assign',key,`Assign ${label.toLowerCase()}`,!level||!Campaign.free(c)||c.jobs[key]>=cap||disabled(c))}</div>`
            +build(c,site,false));
        }).join('');
    },
    army(c){
      return count('Garrison used / capacity',`${Campaign.militaryLoad(c)} / ${Campaign.garrison(c)}`)
        +count('Army power',Campaign.armyPower(c))+count('Army power against a dragon',Campaign.armyPower(c,true))
        +Object.entries(Campaign.troopTypes).filter(([,t])=>t[1]<=c.level).map(([key,[label,,site,cost,days]])=>{
          const units=c.army[key],gear=c.gear[key];
          const options=Campaign.equipment[key];
          const installed=(gear.choices??[]).map((choice,i)=>options[i][choice]).join(' · ');
          const upgrade=(options[gear.tier]??[]).map((name,i)=>b('gear',`${key}.${i}`,`Equip ${name} · ${money(Campaign.gearCost(c,key,i))}`,
            disabled(c)||!units.length||gear.tier>=Campaign.gearCap(c,key)||!Campaign.canPay(c,Campaign.gearCost(c,key,i))||!!due(c,'gear',key))).join('');
          return card(label,count('Soldiers',units.length)+count('Veterancy',Campaign.rank(units))+count('Equipment tier',gear.tier||'Basic')
            +(installed?count('Equipped options',installed):'')+count('Loadout',gear.mode==='dragon'?'Anti-dragon':'Field')
            +`<div class="actions">${b('train',key,`Train · ${money(cost)} · ${days} days`,!Campaign.canTrain(c,key))}
              ${b('demobilize',key,'Demobilize one',!units.length||disabled(c))}
              ${upgrade}
              ${b('loadout',key,`Switch to ${gear.mode==='dragon'?'field':'anti-dragon'} · 1 equipment`,disabled(c)||!units.length||gear.tier<2||c.stock.equipment<1||!!due(c,'loadout',key))}</div>`
            +queuedText(c,'train',key)+queuedText(c,'gear',key)+queuedText(c,'loadout',key)
            +build(c,site));
        }).join('')+card('Fortifications',['wall','tower','ballista','bastion'].filter(k=>Campaign.buildings[k][1]<=c.level)
          .map(k=>build(c,k)).join(''));
    },
    dragon(c){
      const d=c.dragon;
      if(!Campaign.livingDragon(c))return `<p>${d.departed?'The guardian left the village.':'The guardian has fallen.'} The village can still repel the invasion.</p>`;
      const stance=['guard','hunt','rest'].map(k=>b('stance',k,k[0].toUpperCase()+k.slice(1),disabled(c)||d.stance===k||k==='rest'&&c.threat?.wave===3)).join('');
      return count('Dragon level',d.level)+count('Injury health',`${fmtCampaign(d.health)} / ${Campaign.dragonMax(c)}`)
        +count('Favor',d.favor)+count('Provision reserve',d.reserve)+count('Stance',escapeText(d.stance))
        +(c.demand?card('Demand',count('Due day',c.demand.due)+count('Requested',money(c.demand.cost))
          +b('demand','deliver','Meet demand · +9 favor',!Campaign.canPay(c,c.demand.cost)||disabled(c))+b('demand','refuse','Refuse demand · −9 favor',disabled(c))):'')
        +(c.departure?card('The guardian asks to leave','<p>At zero favor, the guardian will not defend. Departure damages village buildings. The Town Center is protected.</p>'
          +b('departure','keep','Ask the guardian to stay',disabled(c))+b('departure','leave','Accept departure',disabled(c))):'')
        +`<div class="actions">${stance}${b('offer','','Offer 5 provisions',c.stock.food<5||disabled(c))}
          ${b('salve','','Use salve · recover 14 health',c.stock.salve<1||d.health>=Campaign.dragonMax(c)||disabled(c))}
          ${b('dragon-grow','','Advance guardian · 12 provisions · 4 livestock · 4 herbs',d.level>=c.level||d.victories<d.level||disabled(c)||!Campaign.canPay(c,{food:12,livestock:4,herbs:4}))}</div>`;
    },
    altar(c){
      const o=c.altar.offer;
      const blessing=Campaign.blessings[c.altar.blessing];
      let recruit=b('summon','',`Pay to summon · ${money(Campaign.summonCost(c))}`,!Campaign.canSummon(c));
      if(o?.arrival)recruit=count('Hero arrives',`Day ${o.arrival}`);
      else if(o){
        recruit=(o.category?count('Offered specialty',escapeText(o.specialty))
          +Campaign.traits.map((trait,i)=>b('choose-hero',i,`Recruit · ${trait}`,disabled(c))).join('')
          +b('reroll','',`Reroll ${o.rerolls+1} · ${money(Object.fromEntries(Object.entries(o.cost).map(([k,v])=>[k,Math.ceil(v*(o.rerolls+1)*.5)])))}`,
            disabled(c)||o.rerolls>=3||!Campaign.categories[o.category].some(x=>x!==o.specialty&&!c.heroes.some(h=>h.specialty===x))):o.options.map(k=>b('category',k,k[0].toUpperCase()+k.slice(1),disabled(c))).join(''))
          +b('cancel-hero','','Cancel summoning · no refund',disabled(c));
      }
      return count('Altar blessing',blessing||'None selected')+count('Hero slots filled',`${c.heroes.length} / ${c.level-1}`)
        +count('Altar status',c.day<c.altar.lockedUntil?`Locked until Day ${c.altar.lockedUntil}`:'Ready')
        +`<div class="actions">${Object.entries(Campaign.blessings).map(([id,label])=>b('bless',id,label,c.day<c.altar.lockedUntil||id===c.altar.blessing||disabled(c))).join('')}</div>`
        +card('Summoning',recruit)
        +c.heroes.map((h,i)=>card(escapeText(h.specialty),count('Trait',Campaign.traits[h.trait])+count('Level',h.level)+count('Health',h.health)
          +count('Battle position',escapeText(h.mode))+`<div class="actions">${['inside','fortifications','engage'].map(k=>b('hero-mode',`${i}.${k}`,k,h.mode===k||disabled(c))).join('')}
          ${b('hero-train',i,'Level up · 8 provisions · 1 equipment',h.level>=4||disabled(c)||!Campaign.canPay(c,{food:8,equipment:1}))}
          ${b('dismiss',i,'Dismiss · no refund',c.day<c.altar.lockedUntil||disabled(c)||!!o)}</div>`)).join('');
    },
    threat(c){
      const t=c.threat,day=Campaign.nextAttack(c);
      const heading=c.invasionAt!==null?`Invasion wave ${c.wave+1}`:'Next raid';
      if(c.status!=='active')return `<p>${ending(c)}</p>${b('pane','records','Review battle reports')}${b('pane','checkpoints','View checkpoints')}`;
      if(!t)return count(heading,`Day ${day} · ${day-c.day} days away`)+count('Army power',Campaign.armyPower(c))+
        '<p>Four days before contact, the watch reports the incoming force. Scouts can then investigate.</p>';
      const intel=t.intel;
      const estimate=intel&&intel.roll>1&&intel.margin>=-4?(intel.margin>=5?`${t.field} field · ${t.boss} flying`:
        `${Math.round(t.field*(intel.margin>=0?.9:.7))}–${Math.round(t.field*(intel.margin>=0?1.1:1.3))} field`):'Unconfirmed';
      return count(t.wave?`Invasion wave ${t.wave}`:'Raid',`Day ${t.day} · ${Math.max(0,t.day-c.day)} days away`)
        +count('Estimated force',estimate)+count('Army power',Campaign.armyPower(c))
        +(intel?count('Scouting roll',`${fmtCampaign(intel.roll)} → ${fmtCampaign(intel.total)} against ${fmtCampaign(intel.dc)}`)
          +(intel.roll>1&&intel.margin>=0?count('Threat type',escapeText(t.type)):''):'')
        +(t.wave===3?'<p>The evil dragon accompanies the final wave. Invasion forces fight until defeated or the Town Center falls.</p>':'')
        +b('scout','watch','Send scout · 3 provisions · 1 day',!Campaign.free(c)||c.day+1>=t.day||!!intel||!!due(c,'scout','watch')||c.stock.food<3)
        +queuedText(c,'scout','watch')
        +b('fight','','Resolve battle',c.day<t.day);
    },
    encounters(c){
      const e=c.event,h=e&&CampaignEvents.roster[e.id];
      let current='<p>No encounter is waiting for a decision.</p>';
      if(h){
        current=card(h.title,`<p>${h.description}</p>`+count('Deadline',`Day ${e.due}`)
          +(e.target?count('Affected building',escapeText(Campaign.buildings[e.target]?.[0]??e.target)):'')
          +`<div class="actions">${h.options.map((choice,i)=>b('event',i,choice.label,disabled(c)||!choice.enabled(c))).join('')}
          ${b('event','pass',h.miss?'Accept the consequence':'Pass on the encounter',disabled(c))}
          ${media.has(e.id)?b('clip',e.id,'Play encounter clip'):''}</div>`);
      }
      return current+(c.eventHistory.length?card('Encounter history',c.eventHistory.slice().reverse().map(h=>count(`Day ${h.day} · ${CampaignEvents.roster[h.id]?.title??'Encounter'}`,escapeText(h.result))).join('')):'');
    },
    journal(c){
      const fragments={seal:['The Traveler’s Seal','A copied seal confirms that the east road was open.'],shadow:['Shadow Across the Pass','A wing crossed the pass. Ballistae and anti-dragon equipment can help against flying threats.'],
        lamps:['Lamps Along the Ridge','The watch mapped a weak sector. Your next fortification repair saves two timber.']};
      return c.journal.map(id=>Campaign.stories[id]??fragments[id]).filter(Boolean).map(([label,copy])=>card(label,`<p>${copy}</p>`)).join('')
        +card('Village ledger',c.log.slice(-18).reverse().map(x=>count(`Day ${x.day}`,escapeText(x.text))).join(''));
    },
    records(c){
      const list=c.reports.slice().reverse();
      return (c.status!=='active'?card('Campaign outcome',`<p>${ending(c)}</p>${b('pane','checkpoints','View checkpoints')}`):'')
        + b('first-report','','Read the first raid report')
        + (list.length?list.map((r,index)=>card(`Day ${r.day} · ${r.wave?`Wave ${r.wave}`:'Raid'} · ${escapeText(r.outcome)}`,
          count('Available field strength / flying strength',`${fmtCampaign(r.field)} / ${fmtCampaign(r.boss)}`)
          +count('Wall health',`${fmtCampaign(r.wallBefore)} → ${fmtCampaign(r.wallAfter)}`)
          +count('Town Center health',`${fmtCampaign(r.hallBefore)} → ${fmtCampaign(r.hallAfter)}`)
          +count('Guardian health',`${fmtCampaign(r.guardianBefore)} → ${fmtCampaign(r.guardianAfter)}`)
          +Object.entries(Campaign.troopTypes).filter(([key])=>r.casualties[key]>0).map(([key,t])=>count(`${t[0]} lost`,r.casualties[key])).join('')
          +Object.entries(Campaign.resources).filter(([key])=>r.plunder[key]>0).map(([key,label])=>count(`${label} taken`,r.plunder[key])).join('')
          +`<details ${index===0?'open':''}><summary>${r.rounds.length} combat ${r.rounds.length===1?'round':'rounds'}</summary><table class="production-table"><thead><tr><th scope="col">Round</th><th scope="col">Roll</th><th scope="col">Field</th><th scope="col">Flying</th><th scope="col">Wall</th><th scope="col">Town</th></tr></thead><tbody>`
          +r.rounds.map(r=>`<tr>${['round','roll','field','boss','wall','town'].map(k=>`<td>${k==='roll'&&Number.isFinite(r.roll)?r.roll.toFixed(2):fmtCampaign(r[k])}</td>`).join('')}</tr>`).join('')
          +'</tbody></table></details>')).join(''):'<p>No campaign battles have been resolved yet.</p>');
    },
    checkpoints(c){
      return '<p>Restart from a village milestone with the economy, queues, and random state saved at that point.</p>'
        +Object.entries(c.checkpoints).map(([l,point])=>card(`Village Level ${l}`,count('Saved day',point.day)
          +b('restore',l,`Restart from Level ${l}`))).join('');
    }
  };
  function build(c,key,showTitle=true){
    const d=c.buildings[key],label=Campaign.buildings[key][0];
    const project=c.queue.find(j=>j.kind==='build'&&j.key===key);
    return `<div class="campaign-building">${showTitle?count(label,d.level?`Level ${d.level} · ${fmtCampaign(d.health)}% condition`:'Unbuilt'):count('Building condition',d.health)}
      <div class="actions">${b('build',key,`${d.level?'Upgrade':'Build'} ${label} · ${money(Campaign.buildCost(c,key))}`,!Campaign.canBuild(c,key))}
      ${d.level&&d.health<100?b('repair',key,`Repair · ${money(Campaign.repairCost(c,key))}`,!Campaign.canRepair(c,key)):''}
      ${project?b('accelerate',key,'Assign another builder · finish one day sooner',disabled(c)||!Campaign.free(c)||project.day<=c.day+1||project.workers>=3):''}</div>
      ${queuedText(c,'build',key)}${queuedText(c,'repair',key)}</div>`;
  }
  function ending(c){
    return {victory:'Victory. The village repelled all three invasion waves and the Town Center still stands.',
      defeat:'Defeat. The village can no longer continue. Review the ledger or restart from a milestone.',
      stall:'The battle stalled. Its report and state are preserved. Restart from a milestone to continue.'}[c.status]??'';
  }
  const media=new Set();
  async function discoverMedia(id){
    if(media.has(id))return;
    try{
      const response=await fetch(`encounters/${id}.mp4`,{method:'HEAD'});
      if(response.ok&&response.headers.get('content-type')?.startsWith('video/')){
        media.add(id);
        if(village.campaign?.event?.id===id&&selected==='campaign')render();
      }
    }catch { /* Encounters are always playable with text. */ }
  }
  function clip(id){
    if(!media.has(id)||!CampaignEvents.roster[id])return;
    stop();const dialog=$('encounterMedia');
    $('encounterMediaTitle').textContent=CampaignEvents.roster[id].title;
    $('encounterVideo').src=`encounters/${id}.mp4`;
    dialog.showModal();
  }
  function renderPane(c,pane){
    const tabs=Object.entries(names).map(([key,label])=>`<button data-action="campaign:pane:${key}" aria-pressed="${pane===key}">${label}${key==='encounters'&&c.event?' · New':''}</button>`).join('');
    return `<nav class="campaign-tabs" aria-label="Campaign sections">${tabs}</nav>`
      +count('Village day',c.day)+(pane==='records'||c.status==='active'?'':`<p>${ending(c)}</p>`)
      +panels[pane](c);
  }
  return { renderPane, discoverMedia, clip, names };
})();
