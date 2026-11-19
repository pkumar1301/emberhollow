"""dv_engine 3.0: shared Dragon Village campaign engine implementing SIM-FIX-3 (revision 2 + final run plan).

Python standard library only. Both applications import this module unchanged.
Rules marked FIX-3 follow claude/sim-fix-set-3.md and the final run plan of 6 Nov 2026.
Flags let a run reproduce FIX-2 behaviour (TARGET='fix2', GEAR='village') for the order-only comparison,
and switch the Part B balance trials on one at a time. All numeric settings are experimental.
"""
import random, math

VERSION='3.2h-trial'
# 3.2-trial (6 Nov 2026): evenly matched final wave. All additions are behind INVASION_MODEL (off = 3.1 behaviour).
#  invasion variants (field-heavy, dragon-heavy, balanced) drawn per world; invasion intel roll at Level 4;
#  adaptive players set equipment kit and fortification plan from intel; towers; BOSS_MULT
# 3.1 corrections (6 Nov 2026), found by the independent Codex round test and review:
#  C1 a ballista makes one allocation per round: it fires at the boss only if the boss was alive at the start of its volley,
#     and at field troops only if no boss was alive at the start of its volley
#  C2 the lone-evil-dragon shortcut counts its remaining rounds with the same breach allocation the replay uses (incl. B7)
#  C3 a dismissed hero takes its recurring bonus (harvest, army/defense, scouting) with it
RES = ('grain','food','timber','stone','iron','livestock','herbs','salve','gear')
VALUE = dict(food=1,grain=.7,timber=1,stone=1.2,iron=2,livestock=2.5,herbs=2,salve=3,gear=3)

BASE = dict(
    # FIX-1
    RAID=.70, WALL_GROW=.30, WALL_COST={'stone':.70,'timber':.50}, REBUILD=10, REGEN=4.0, LEAVE_DAYS=5,
    CIV_SHARE=.5, CIV_FLOOR=.5, CIV_REPAIR=3., CIV_COST=.1, PLUNDER=.10, RESERVE={'food':10,'grain':10,'timber':8,'stone':8},
    DUEL_FAVOR=.25, DUEL_RESERVE=.15, UPKEEP=.13, UPKEEP_STEP=.04, UPKEEP_FREE=6, DPOW_LVL=4, DPOW_BASE=2, LIVESTOCK=.06,
    DEM_INT=(15,35), DEM_SIZE=(4,10), DEM_MET=8, DEM_REF=-6, DEM_BUFF=.15, DEM_BUFF_DAYS=3, HERO_FOOD=.10, HIDE=.05, WITHDRAW=.05,
    # FIX-2
    GAP=12, SPREAD=(.65,1.45), FINAL=1.35, TOL_BASE=2, TOL_LVL=1, RESENT=.10, RESENT_MAX=.60, RESENT_FLOOR=40,
    SOLE_DUEL=.25, SOLE_RAID=.15, FOCUS_FULL=1.0, FOCUS_SPLIT=.5, WEAK_DUEL=.15, WALL_FIRE=.075, WALL_FIRE_CAP=6.0,
    BALLISTA_COST={'stone':20,'timber':15,'iron':6}, BALLISTA_MAX=3, BALLISTA_EVERY=10, BALLISTA_BASE=.8,
    BOLT_COST={'iron':.5,'timber':.5,'herbs':.2}, BOLT_RATE=.3, BOLT_CAP=60, BOLT_DMG=1.8,
    GEAR_TIER=.09, GEAR_EQUIP=.5, GEAR_UPKEEP=.02, GEAR_RIGHT=1.06, GEAR_WRONG=.94, AD_SHARE=.85, PLAIN_SHARE=.48, AD_ARMY=.90,
    HERO_FIRE=.4, CIV_RATION=.14,
    # FIX-3 conventions
    TARGET='v3',          # 'v3' = A4 targeting and simultaneous field exchange; 'fix2' = engine_fix2 combat
    GEAR='soldier',       # 'soldier' = A6 per-soldier tiers; 'village' = FIX-2 village-wide tiers
    SHORTCUT=True,        # A5 lone-evil-dragon shortcut
    ROUND_LIMIT=100,      # A5: consecutive rounds with no change to any health or strength before a stall is declared
    HARD_CAP=20000,
    EPS=0.01,             # an enemy force or boss below this strength counts as destroyed
    # Part B trial switches (defaults = no trial)
    DRAGON_HEAL_MULT=1.0,     # B1: multiplies REGEN
    GEAR_RESERVE=0,           # B2: gear kept back from upgrades for replacements
    FORTUNE=False,            # B4: one defender-only roll per battle, x0.85..x1.15
    B6_POWER=0.0,             # B6a: soldier base power bonus
    B7_WALLS=False,           # B7: 70/30 single-charge breach split
    INVEST_CAP_PRE=None,      # B8: cap on discretionary defense purchases before wave 1 (value units)
    INVEST_CAP_INV=None,      # B8: cap on discretionary purchases from wave 1 on (replacements)
    BUDGET_TOTAL=False,       # B8: caps count all defense spend, upkeep included (upkeep is never blocked)
    # 3.2-trial: evenly matched final wave
    INVASION_MODEL=False,
    VARIANTS={'field':(1.25,0.80),'dragon':(0.80,1.35),'balanced':(1.0,1.0)},   # (field army x, evil dragon x)
    BOSS_MULT=1.0,            # evil dragon health and strike, all variants
    INTEL_DC=16,              # invasion intel: d20 + scouts + 3 (scouting hero) at Level 4 arrival, with advantage
    TOWER_COST={'stone':12,'timber':8}, TOWER_EVERY=8, TOWER_FIRE=1.0,
    PLANS={'towers':dict(towers=6,ballistae=1,wall=1.0,bolts=0.5),'ballistae':dict(towers=1,ballistae=5,wall=1.0,bolts=2.0),
           'walls':dict(towers=2,ballistae=2,wall=1.3,bolts=1.0),'balanced':dict(towers=3,ballistae=3,wall=1.0,bolts=1.0)},
    RIGHT_PLAN={'field':'towers','dragon':'ballistae','balanced':'balanced'},
    RIGHT_KIT={'field':False,'dragon':True,'balanced':None},     # anti_dragon_gear value that counters each variant (None = either)
    WRONG_PLAN={'field':'ballistae','dragon':'towers','balanced':'walls','siege':'towers'},
    # 3.2b option 3: housing and diminishing returns
    HOUSING=False, HOUSE_PLOTS=[3,4,5,6], HOUSE_BEDS=[5,6,7,7,8,8,8,9,9,9], HOUSE_CEIL=[3,6,9,10], HOUSE_START=[3,2],
    HOUSE_BUILD={'timber':6,'stone':4}, HOUSE_UP=(2.0,1.5,1.0,1.2), HOUSE_EVERY=3, HOUSE_FOOD_GATE=25,     # upgrade to L: timber a+b*L, stone c+d*L
    # v3.3 rule proposal: one counter per invasion, Pride, garden upgrade
    COUNTER_MODEL=False, HORDE_BONUS=.40, WYRM_BONUS=.50, SIEGE_WALL=1.0, SIEGE_TOWER=.5, NEED_TOWERS=4, NEED_BALLISTAE=3,
    PRIDE=False, PRIDE_STEP=.03, PRIDE_MAX=.45,
    GARDENS=False, GARDEN_COST={'timber':5,'stone':3}, GARDEN_FOOD=.10,
    # run 7: dragon entry rules and a tighter economy
    GARRISON=None,        # run 9: garrison slots by level, e.g. [8,13,18,22]; soldier 1, tower 1, ballista 1, dragon 2 per level
    DRAGON_SLOTS=2, CREW_RESERVE=8, DRAGON_SLOT_TABLE=None,
    RAID_GAPS=None,       # run 9: days between raids at Levels 1-4, e.g. [25,20,15,10]; Level 4 raids stop RAID_STOP days before the first final wave
    RAID_STOP=5, SPILL_ARMY=False, FILL_SLOTS=False,
    FINAL_DAY=None,       # run 9: the final wave uses this fixed day for its strength instead of the day it arrives
    PARTIAL_KIT=False, KIT_TIER=4, KIT_RIGHT_FRAC={'horde':.33,'wyrm':.5,'siege':.33}, KIT_WRONG_FRAC=.15, KIT_RIGHT_NODRAGON=None, KIT_WRONG_NODRAGON=None, KIT_NOINTEL_FRAC=.25, KIT_TOL=.08,   # run 10
    DRAGON_UPKEEP_HI=0.0,  # run 10: dragon food/livestock/herbs x(1+this*(level-2)) at levels 3-4
    RAID_LVL=None,         # run 10: raid strength by village level, replaces RAID (e.g. [.7,.9,1.1,1.3])
    LEVEL_LOSS=False, LOSS_PER=12., LOSS_STEP=.06, LOSS_FLOOR=.55, LOSS_REBUY_DAYS=4,   # run 10: building level loss when a raid breaches the walls
    FLYERS=False, FLY_STR=[.25,.40], FLY_RETREAT=.5, FLY_ROUNDS=8, FLY_BURN=.04, FLY_WOUND=1.5, FLY_STOP=10, FLY_ESCORT=1.0,   # run 10: wyrms / young dragons in Level 4 raids
    LEARN=False, LEARN_KIT=.2, LEARN_BOLTS=1.5,   # run 10: average players add anti-dragon kit and bolts after their first flying raid
    SAVE_UP=False, WALL_REPAIR=0.0, REPAIR_COST=.5,   # run 10: good players save for the next village level; damaged walls repair faster than new walls grow
    TRAIN_PARALLEL=None,  # run 11: soldiers that can train at once by village level, e.g. [1,1,2,3]
    FILL_PRIMARY=False,   # run 11: a soldierless village puts spare garrison slots only into its plan's main counter (none for the walls plan)
    AD_ONLY=False,        # run 8: only dragons, ballistae and soldiers with the anti-dragon kit can damage the evil dragon
    ENTRY=None, ENTRY_LOSS=.5, BOSS_PRESSURE=.35, SECOND_WIND=0.0,   # on your dragon's entry the evil dragon recovers to at least this share of its starting health   # pressure: share of evil-dragon health added to field damage when no dragon opposes it            # 'A' late entry (army down to tolerance) / 'D' evil dragon challenge (half the army lost or walls down)
    BUDGET_PLANS=False, PRIMARY_CAP={'towers':6,'ballistae':5}, SECONDARY_CAP=2, REINFORCE_COST={'stone':60,'iron':20},
    HOARD=False, HOARD_RATE=.3, HOARD_CAP=.25, HOARD_SCALE=40.,
    DR=False, GEAR_TABLE=[.15,.10,.06,.04], DPOW_TABLE=[8,12,15,17], WALL_DR_SCALE=60.,
)

def soldier_power(i):return 1.4+i*.24

class Run:
    def __init__(self,seed,profile,cfg=None,fixed=None):
        self.c=dict(BASE,**(cfg or {}))
        self.p=dict(profile)
        c=self.c;p=self.p
        p.setdefault('walls_from',1);p.setdefault('ballistae',False);p.setdefault('bolts_target',0);p.setdefault('anti_dragon_gear',False)
        p.setdefault('feed',['civilians','soldiers','heroes','dragon'])
        self.seed=seed;self.difficulty=.95
        # A3 random streams
        self.rng=random.Random(seed);self.enemy_rng=random.Random(seed+11931);self.events=random.Random(seed+770000)
        self.altar=random.Random(seed+880000);self.gear_rng=random.Random(seed+990000);self.fortune_rng=random.Random(seed+1110000)
        if fixed:   # test hook: replace named streams with scripted values
            for name,obj in fixed.items():setattr(self,name,obj)
        self.next_demand=self.events.randint(*c['DEM_INT'])
        self.grain_bonus=0.;self.defense_bonus=0.;self.demands=0;self.granted=0;self.hero_names=[]
        self.s=dict(zip(RES,(12,35,18,12,0,0,0,0,0)))
        self.stage=self.day=self.level=1
        self.people=16          # villagers including soldiers (heroes counted separately)
        self.soldiers=[]        # A6: [type, tier, born_day, upgraded_day]
        self.hp,self.favor,self.town=60.,65.,70.
        self.fort=35. if p['walls'] and p['walls_from']<=1 else 0.
        self.reserves={k:18. for k in ('food','livestock','herbs')}
        self.vet=self.xp=self.heroes=0;self.hero_list=[]
        self.hungry={'civilians':0,'soldiers':0,'heroes':0}
        self.recruit=self.train=self.up=None
        self.stage_days=[];self.raids=0;self.wounded=0.;self.wave=0
        self.starved_days=0;self.field_losses=0;self.food_low_days=0
        self.next_raid=36;self.next_wave=None
        self.wall_down_until=0;self.zero_favor_days=0;self.civ=0.;self.buff_until=0
        self.dspend=0.;self.plundered=0.;self.deserted=0;self.left=False
        self.ballistae=0;self.next_ballista=0;self.bolts=0.;self.vtiers=0;self.skip_upgrades_until=0
        self.boss_by={'dragon':0.,'ballista':0.,'army':0.,'walls':0.};self.boss_killed_by=None
        self.invested={'pre':0.,'inv':0.};self.dspend_pre=0.
        self.towers=0;self.next_tower=0;self.wall_mult=1.0;self.housing_spend=0.;self.next_house=0
        self.houses=[c['HOUSE_START'][1]]*c['HOUSE_START'][0] if c['HOUSING'] else []
        self.gardens=[False]*len(self.houses);self.boss_var=1.0;self.counter=None
        self.reinforced=False;self.hoard=0.;self.duel=None
        self.train_extra=[];self.kit_frac=None;self.flier=0.;self.fly_raids=0;self.learned=False;self.sighted=False
        self.upcost=None;self.fort_peak=0.;self.lost_levels=0;self.levels_lost_total=0;self.raids_breached=0;self.next_rebuy=0;self.l2_grace=True
        self.variant=random.Random(seed+1220000).choice(sorted(c['VARIANTS'])) if c['INVASION_MODEL'] else None
        self.intel=None;self.plan=p.get('fort_plan','balanced');self.kit_right=None
        self.waves=[];self.cause=None;self.stall_state=None;self.lost_stage=None;self.fortune_log=[]
        self.report=[]   # per-round damage log of the latest encounter
        self.log_rounds=False
    # ---------- helpers
    def units(self):
        u=[0,0,0,0]
        for sd in self.soldiers:u[sd[0]]+=1
        return u
    def army(self):return len(self.soldiers)
    def slots_used(self):
        return self.army()+int(bool(self.train))+len(self.train_extra)+self.towers+self.ballistae+self.dslots(max(self.level if self.p['dragon'] else 0,min(self.p['dragon'],self.stage)))
    def dslots(self,lv):
        t=self.c['DRAGON_SLOT_TABLE'];return (t[lv-1] if lv else 0) if t else self.c['DRAGON_SLOTS']*lv
    def slots_free(self):
        g=self.c['GARRISON'];return 10**9 if not g else g[self.stage-1]-self.slots_used()
    def value(self,cost):return sum(VALUE[k]*v for k,v in cost.items())
    def spend(self,cost,defense=False,invest=False):
        if any(self.s[k]+1e-9<v for k,v in cost.items()):return False
        if invest:
            ph='inv' if self.wave>=1 else 'pre';cap=self.c['INVEST_CAP_INV' if ph=='inv' else 'INVEST_CAP_PRE']
            used=(self.dspend-self.dspend_pre if ph=='inv' else self.dspend) if self.c['BUDGET_TOTAL'] else self.invested[ph]
            if cap is not None and used+self.value(cost)>cap+1e-9:return False
            self.invested[ph]+=self.value(cost)
        for k,v in cost.items():self.s[k]-=v
        if defense:self.dspend+=self.value(cost)
        return True
    def extra_ok(self,cost):
        """run 10: while saving for the next village level, optional spending may not eat into the upgrade cost."""
        u=self.upcost
        return not u or all(self.s[k]-cost.get(k,0)>=u.get(k,0)-1e-9 for k in cost)
    def prod(self):return max(self.c['CIV_FLOOR'],1-self.civ/100)*(max(self.c['LOSS_FLOOR'],1-self.c['LOSS_STEP']*self.lost_levels) if self.c['LEVEL_LOSS'] else 1)
    def store(self,k,v):
        group=('grain','food') if k in ('grain','food') else (('livestock',) if k=='livestock' else ('timber','stone','iron','herbs','salve','gear'))
        cap=(30 if k=='livestock' else 155)*self.stage
        target={'grain':35,'food':100,'timber':66,'stone':56,'iron':13,'gear':13,'herbs':6,'salve':4,'livestock':16}[k]*self.stage
        n=max(0,min(v,target-self.s[k],cap-sum(self.s[j] for j in group)))
        self.s[k]+=n;return n
    def process(self,k,inputs,amount):
        n=min([amount]+[self.s[r]/v for r,v in inputs.items()])
        n=self.store(k,n)
        for r,v in inputs.items():self.s[r]-=n*v
    def dmax(self):return 50+14*self.level
    def remove_soldier(self):
        """Casualty or desertion: the most numerous type loses its most recently trained soldier; gear goes with it."""
        u=self.units();t=max(range(4),key=u.__getitem__)
        idx=max((k for k,sd in enumerate(self.soldiers) if sd[0]==t),key=lambda k:(self.soldiers[k][2],k))
        self.soldiers.pop(idx)
    def tier_of(self,sd):return self.vtiers if self.c['GEAR']=='village' else sd[1]
    @staticmethod
    def tier_material(t):return 'timber' if t<=2 else 'gear'
    # ---------- the day (A2 order)
    def tick(self):
        c=self.c;s=self.s;t=self.day
        # 1 arrivals
        if self.recruit==t:self.people+=1;self.recruit=None
        if self.train and self.train[0]==t:self.soldiers.append([self.train[1],0,t,t]);self.train=None
        if self.train_extra:
            for d,u in [x for x in self.train_extra if x[0]==t]:self.soldiers.append([u,0,t,t])
            self.train_extra=[x for x in self.train_extra if x[0]!=t]
        if self.up==t:
            self.stage+=1;self.stage_days.append(t);self.up=None
            if self.stage==3:self.sighted=True
            if self.stage==4:
                self.next_wave=t+48
                if self.c['INVASION_MODEL']:self.invasion_intel()
        stage=self.stage;army=self.army();training=int(bool(self.train))+len(self.train_extra)
        self.upcost={'stone':12*1.7**(stage-1),'timber':16*1.7**(stage-1)} if (c['SAVE_UP'] and self.p.get('save_up') and stage<4 and not self.up and t>=(0,72,188,326)[stage]+self.p['pace'][stage-1]) else None
        workers=self.people-army-training
        dragon_target=self.p['dragon']
        # 2 production
        crew=max(0,workers-2-int(bool(self.up))-int(self.civ>0))
        farm=min(crew//3,4+stage);mill=min(crew//4,2+stage)
        if s['food']>self.p['buffer'] and s['grain']>12:farm=max(1,farm-1)
        if s['food']<self.p['buffer'] and farm<4+stage and crew>farm+mill:farm+=1
        other=max(0,crew-farm-mill);m=self.prod();self._other=other;self._mill=mill;self._m=m
        if c['GARDENS'] and self.houses:
            gb=sum(c['HOUSE_BEDS'][l-1] for l,g in zip(self.houses,self.gardens) if g);tb=self.beds()
            if gb:self.store('food',c['GARDEN_FOOD']*gb*min(1,self.people/max(1,tb)))
        self.store('grain',farm*1.55*(1+self.grain_bonus)*m)
        self.process('food',{'grain':1.3},min(mill*2,max(0,(s['grain']-(.65 if stage>=2 and dragon_target else 0))/1.3)))
        self.store('timber',other*.23*m);self.store('stone',other*.17*m)
        if stage>=2:
            if s['herbs']>2:self.process('salve',{'herbs':1.4},.17)
            self.store('herbs',other*.055*m);self.process('livestock',{'grain':1.1},other*.045*m)
        if stage>=3:
            self.process('iron',{'timber':.45},other*.12*m)
            if s['gear']<28:self.process('gear',{'iron':.6,'timber':.7},other*.09*m)
        # 3 food bills in feeding priority
        per=c['UPKEEP']*(1+c['UPKEEP_STEP']*max(0,army-c['UPKEEP_FREE']))
        bills={'civilians':(self.people-army)*c['CIV_RATION'],'soldiers':army*(c['CIV_RATION']+per),'heroes':self.heroes*c['HERO_FOOD']}
        dragon_alive=self.hp>0 and not self.left
        dhi=1+c['DRAGON_UPKEEP_HI']*max(0,self.level-2)
        dragon_food=(.6*self.level+.2)*dhi if dragon_alive and (dragon_target or t<27) else 0
        fed_ok={}
        for g in self.p['feed']:
            if g=='dragon':
                d=min(s['food'],dragon_food);s['food']-=d;self.dspend+=d*VALUE['food']
                if dragon_alive:self.reserves['food']=max(0,min(18+4*self.level,self.reserves['food']+d-.6*self.level))
                continue
            need=bills[g];paid=min(s['food'],need);s['food']-=paid
            if g!='civilians':self.dspend+=paid*VALUE['food']*(per/(c['CIV_RATION']+per) if g=='soldiers' else 1)
            fed_ok[g]=paid+1e-9>=need
        short=not all(fed_ok.values());self.food_low_days+=int(short)
        # 4 hunger
        soldiers_at_start=army
        for g in ('civilians','soldiers','heroes'):
            self.hungry[g]=0 if fed_ok.get(g,True) else self.hungry[g]+1
        if self.hungry['soldiers']>=4 and self.soldiers:
            self.remove_soldier();self.deserted+=1     # deserter joins the civilians
        if self.hungry['heroes']>=4 and self.heroes:self.dismiss_hero()
        if self.hungry['civilians']>=4 and soldiers_at_start==0:
            if self.people-self.army()-int(bool(self.train))>0:self.people-=1
            elif self.train:self.train=None;self.people-=1
        any_hungry=any(self.hungry[g]>0 for g in self.hungry)
        # 5 gear upkeep
        self.gear_upkeep()
        # 6 dragon offerings, healing, favor, resentment
        if self.hp>0:
            fed=self.reserves['food']>0
            dhi=1+c['DRAGON_UPKEEP_HI']*max(0,self.level-2)
            for k,v in [('livestock',max(0,self.level-1)*c['LIVESTOCK']*dhi),('herbs',max(0,self.level-2)*.08*dhi)]:
                if not v:continue
                d=min(s[k],v+.2) if (dragon_target or t<27) and not self.left else 0
                s[k]-=d;self.dspend+=d*VALUE[k]
                self.reserves[k]=max(0,min(18+4*self.level,self.reserves[k]+d-v));fed&=self.reserves[k]>0
            if not fed:self.starved_days+=1;self.hp-=1.2;self.favor=max(0,self.favor-.8)
            else:
                salve=self.hp<self.dmax() and self.spend({'salve':.1},True)
                self.hp=min(self.dmax(),self.hp+c['REGEN']*c['DRAGON_HEAL_MULT']*(.45+(1.2 if salve else 0)))
            excess=self.army()-(c['TOL_BASE']+c['TOL_LVL']*self.level)
            if excess>0 and self.favor>c['RESENT_FLOOR']:self.favor=max(c['RESENT_FLOOR'],self.favor-min(c['RESENT_MAX'],c['RESENT']*excess))
            # 7 demand
            if t==self.next_demand:
                self.next_demand=t+self.events.randint(*c['DEM_INT']);self.demands+=1
                resource=self.events.choice(['food']+(['livestock','herbs'] if stage>=2 else []))
                rate={'food':mill*2,'livestock':other*.045,'herbs':other*.055}[resource]
                window=self.events.randint(2,6)
                ask=min(self.events.uniform(*c['DEM_SIZE'])*self.level,.3*max(s[resource],rate*window))
                met=s[resource]-ask>=self.p['keep']*(1 if resource=='food' else .15) and self.spend({resource:ask},True)
                self.granted+=bool(met)
                if met:self.buff_until=t+c['DEM_BUFF_DAYS']
                self.favor=max(0,min(100,self.favor+(c['DEM_MET'] if met else c['DEM_REF'])))
            # 8 departure
            self.zero_favor_days=self.zero_favor_days+1 if self.favor<=0 else 0
            if self.zero_favor_days>=c['LEAVE_DAYS']:self.hp=0;self.left=True
            elif not fed and self.hp<18:self.hp=0;s['food']=max(0,s['food']-4)
            # 9 advancement
            nxt=c['LIVESTOCK']*self.level
            if self.hp>0 and other*.045*m>=1.2*nxt and self.xp>=3*self.level and self.level<min(stage,dragon_target) and s['food']>=self.p['advance_stock']:
                self.level+=1
        if c['HOARD'] and self.p.get('hoard') and self.stage==4 and self.hp>0 and not self.left and self.p['dragon']:
            x=min(c['HOARD_RATE'],max(0,s['livestock']-4))
            if x>0 and self.spend({'livestock':x},True):self.hoard+=x
        # 10 civilian repair
        if self.civ>0:
            pts=min(c['CIV_REPAIR'],self.civ,s['stone']/c['CIV_COST'],s['timber']/c['CIV_COST'])
            if pts>0:s['stone']-=pts*c['CIV_COST'];s['timber']-=pts*c['CIV_COST'];self.civ-=pts
        if c['LEVEL_LOSS'] and self.lost_levels>0 and t>=self.next_rebuy and self.spend({'stone':6*1.5**(stage-1),'timber':8*1.5**(stage-1)},True,True):
            self.lost_levels-=1;self.next_rebuy=t+c['LOSS_REBUY_DAYS']
        # 11 recruitment queue
        cap=self.beds() if c['HOUSING'] else 18+stage*7
        if self.recruit is None and self.people+self.heroes<cap and self.spend({'food':4}):self.recruit=t+5
        # 12 training (recruitment cost by village level; equipment separate)
        army=self.army();workers=self.people-army-int(bool(self.train))-len(self.train_extra)
        crew_res=0 if not c['GARRISON'] else max(0,round(c['CREW_RESERVE']*self.p.get('invest',1)*(0,.5,.75,1)[stage-1])*(1 if (self.p.get('towers') or self.p['ballistae']) else 0)-self.towers-self.ballistae)
        if not self.train and not any_hungry and army<min(self.p['army'],stage*5) and workers>5 and self.slots_free()-crew_res>0:
            allowed=1 if stage==1 else (2 if stage==2 else 4)
            unit=self.p['mix'][(t+army)%len(self.p['mix'])]%allowed
            cost={'food':3+unit,'timber':2}
            if stage>=3:cost['gear']=1+unit
            if c['GEAR']=='village' and self.vtiers:
                for k,v in self.vcost(self.vtiers,1,c['GEAR_EQUIP']).items():cost[k]=cost.get(k,0)+v
            if self.spend(cost,True,True):self.train=(t+3,unit)
        if c['TRAIN_PARALLEL'] and not any_hungry:
            while len(self.train_extra)<c['TRAIN_PARALLEL'][stage-1]-1:
                army=self.army();tr=int(bool(self.train))+len(self.train_extra)
                if not (army+tr<min(self.p['army'],stage*5) and self.people-army-tr>5 and self.slots_free()-crew_res>0):break
                allowed=1 if stage==1 else (2 if stage==2 else 4)
                unit=self.p['mix'][(t+army+tr)%len(self.p['mix'])]%allowed
                cost={'food':3+unit,'timber':2}
                if stage>=3:cost['gear']=1+unit
                if not self.spend(cost,True,True):break
                self.train_extra.append((t+3,unit))
        # 13 equipment purchases
        if self.p['gear']:self.gear_purchases()
        # 14 ballistae, bolts and (3.2) towers
        plan=c['PLANS'][self.plan] if c['INVASION_MODEL'] else None
        if plan and c['BUDGET_PLANS']:
            inv=self.p.get('invest',1);sec=round(c['SECONDARY_CAP']*inv)
            plan=dict(plan,towers=round(c['PRIMARY_CAP']['towers']*inv) if self.plan=='towers' else (3 if self.plan=='balanced' else sec),
                      ballistae=round(c['PRIMARY_CAP']['ballistae']*inv) if self.plan=='ballistae' else (3 if self.plan=='balanced' else sec))
            if c['GARRISON'] and c['FILL_SLOTS'] and self.p['army']==0:   # run 9: a village with no soldiers crews extra towers or ballistae
                spare=c['GARRISON'][3]-self.dslots(self.p['dragon'])-plan['towers']-plan['ballistae']
                if spare>0 and c['FILL_PRIMARY']:
                    if self.plan=='ballistae':plan=dict(plan,ballistae=plan['ballistae']+spare)
                    elif self.plan=='towers':plan=dict(plan,towers=plan['towers']+spare)
                    elif self.plan=='balanced':plan=dict(plan,towers=plan['towers']+spare//2,ballistae=plan['ballistae']+spare-spare//2)
                elif spare>0:plan=dict(plan,**({'ballistae':plan['ballistae']+spare} if self.plan=='ballistae' else {'towers':plan['towers']+spare}))
            if self.plan=='walls' and not self.reinforced and stage>=3 and self.p['walls'] and self.spend(c['REINFORCE_COST'],True,True):self.reinforced=True
        if plan and self.p.get('towers') and self.p['walls'] and stage>=2:
            if self.towers<(plan['towers'] if c['BUDGET_PLANS'] else round(plan['towers']*self.p.get('invest',1))) and t>=self.next_tower and t>=self.wall_down_until and self.slots_free()>0 and self.extra_ok(c['TOWER_COST']) and self.spend(c['TOWER_COST'],True,True):
                self.towers+=1;self.next_tower=t+c['TOWER_EVERY']
        bmax=(plan['ballistae'] if c['BUDGET_PLANS'] else round(plan['ballistae']*self.p.get('invest',1))) if plan else c['BALLISTA_MAX']
        if self.p['ballistae'] and self.p['walls'] and stage>=3:
            if self.ballistae<bmax and t>=self.next_ballista and t>=self.wall_down_until and self.slots_free()>0 and self.extra_ok(c['BALLISTA_COST']) and self.spend(c['BALLISTA_COST'],True,True):
                self.ballistae+=1;self.next_ballista=t+c['BALLISTA_EVERY']
        want=min(self.p['bolts_target']*(plan['bolts'] if plan else 1),c['BOLT_CAP'])-self.bolts
        if stage>=3 and want>0:
            n=min(c['BOLT_RATE'],want,*(s[k]/v for k,v in c['BOLT_COST'].items()))
            if n>0 and self.spend({k:v*n for k,v in c['BOLT_COST'].items()},True,True):self.bolts+=n
        # 15 walls (3.2b: wall growth gets dearer as walls get bigger)
        wcost=c['WALL_COST'] if not c['DR'] else {k:v*(1+self.fort/c['WALL_DR_SCALE']) for k,v in c['WALL_COST'].items()}
        if self.p['walls'] and stage>=self.p['walls_from'] and t>=self.wall_down_until and self.fort<(22*stage+18)*((1.3 if self.reinforced else (1.15 if self.plan=='balanced' else 1.0)) if (plan and c['BUDGET_PLANS']) else (plan['wall'] if plan else 1)) and self.extra_ok(wcost) and self.spend(wcost,True,True):self.fort+=c['WALL_GROW']
        if c['WALL_REPAIR'] and self.p['walls'] and t>=self.wall_down_until and 0<self.fort<self.fort_peak:
            amt=min(c['WALL_REPAIR'],self.fort_peak-self.fort);rc={'stone':wcost['stone']*amt/c['WALL_GROW']*c['REPAIR_COST']}
            if self.spend(rc,True,True):self.fort+=amt
        self.fort_peak=max(self.fort_peak,self.fort)
        # 15b housing
        if c['HOUSING'] and t>=self.next_house:self.build_housing()
        # 16 village advancement
        limits=(0,72,188,326)
        if stage<4 and not self.up and t>=limits[stage]+self.p['pace'][stage-1] and self.spend({'stone':12*1.7**(stage-1),'timber':16*1.7**(stage-1)}):self.up=t+5
        # 17 heroes
        if stage>1 and self.heroes<min(stage-1,self.p['hero_limit']) and t%17==0 and self.spend({'food':5,'timber':4},True,True):
            self.heroes+=1
            offer=self.altar.sample(['harvest','defense','scouting','dragon','army'],3)
            choice=min(offer,key=self.p['heroes'].index)
            trait=max(self.altar.uniform(.025,.065) for _ in range(3))
            self.hero_names.append(choice);self.hero_list.append((choice,trait))
            if choice=='harvest':self.grain_bonus+=trait
            elif choice=='dragon':self.favor=min(100,self.favor+100*trait)
            elif choice in ('army','defense'):self.defense_bonus+=trait
    def dismiss_hero(self):
        """C3: the most recently summoned hero leaves and takes its recurring bonus with it. The dragon hero's favor gift is one-off and stays."""
        self.heroes-=1
        if not self.hero_list:return
        name,trait=self.hero_list.pop()
        if name=='harvest':self.grain_bonus-=trait
        elif name in ('army','defense'):self.defense_bonus-=trait
        idx=len(self.hero_names)-1-self.hero_names[::-1].index(name);self.hero_names.pop(idx)
    def beds(self):return sum(self.c['HOUSE_BEDS'][l-1] for l in self.houses)
    def counter_fraction(self):
        """v3.3: how much of the invasion's special threat the village cancels (0 = none, 1 = fully countered)."""
        c=self.c;v=self.variant
        if v=='horde':return min(1,self.towers/c['NEED_TOWERS'])
        if v=='wyrm':
            ball=min(1,self.ballistae/c['NEED_BALLISTAE'])*(1 if (self.ballistae and self.bolts>=self.ballistae) else .6)
            sold=self.soldiers;kit=(sum(1 for sd in sold if self.tier_of(sd)>=4)/len(sold)) if (sold and self.p.get('anti_dragon_gear')) else 0
            if c['PARTIAL_KIT']:kit=min(1,(self.kit_frac or 0)/c['KIT_RIGHT_FRAC']['wyrm']) if sold else 0
            return max(ball,kit)
        if v=='siege':
            if c['BUDGET_PLANS']:return 1.0 if self.reinforced else (0.5 if self.plan=='balanced' else 0.0)
            return c['PLANS'][self.plan].get('reinforce',0)
        return 1
    def build_housing(self):
        """Build or upgrade one house toward the profile's housing share of the maximum beds at this village level."""
        c=self.c;st=self.stage;ceil=c['HOUSE_CEIL'][st-1];plots=c['HOUSE_PLOTS'][st-1]
        maxbeds=plots*c['HOUSE_BEDS'][ceil-1]
        if self.beds()>=self.p.get('housing',1.0)*maxbeds:return
        reserve={'timber':8*st,'stone':6*st}
        if c['GARDENS'] and self.houses and sum(self.gardens)<self.p.get('gardens',0)*len(self.houses)-1e-9:
            if all(self.s[k]-v>=reserve[k] for k,v in c['GARDEN_COST'].items()) and self.spend(c['GARDEN_COST']):
                i=max((k for k in range(len(self.houses)) if not self.gardens[k]),key=lambda k:self.houses[k])
                self.gardens[i]=True;self.housing_spend+=self.value(c['GARDEN_COST']);self.next_house=self.day+c['HOUSE_EVERY']
                return
        if self.s['food']<self.c['HOUSE_FOOD_GATE']*st:return   # only add beds the food supply can carry
        if len(self.houses)<plots:
            cost=c['HOUSE_BUILD'];action=('new',None)
        else:
            low=[i for i,l in enumerate(self.houses) if l<ceil]
            if not low:return
            i=min(low,key=lambda k:self.houses[k]);L=self.houses[i]+1;a,b,cc,d=c['HOUSE_UP']
            cost={'timber':a+b*L,'stone':cc+d*L};action=('up',i)
        if any(self.s[k]-cost[k]<reserve[k] for k in cost):return
        if self.spend(cost):
            self.housing_spend+=self.value(cost);self.next_house=self.day+c['HOUSE_EVERY']
            if action[0]=='new':self.houses.append(1);self.gardens.append(False)
            else:self.houses[action[1]]+=1
    def invasion_intel(self):
        """3.2: at Level 4 arrival the chief scouts the coming invasion. Flashbacks give advantage on the roll."""
        c=self.c;r=random.Random(self.seed+1330000)
        bonus=self.p.get('scouts',0)+(3 if 'scouting' in self.hero_names else 0)
        roll=max(r.randint(1,20),r.randint(1,20))+bonus
        self.intel=roll>=c['INTEL_DC']
        force=self.p.get('force_choices')
        if force=='right' or (force is None and self.p.get('adaptive') and self.intel):
            self.plan=c['RIGHT_PLAN'][self.variant]
            k=c['RIGHT_KIT'][self.variant]
            if k is not None:self.p['anti_dragon_gear']=k
        elif force=='wrong':
            self.plan=c['WRONG_PLAN'][self.variant];k=c['RIGHT_KIT'][self.variant]
            if k is not None:self.p['anti_dragon_gear']=not k
            else:self.p['anti_dragon_gear']=self.p.get('anti_dragon_gear',False)
        k=c['RIGHT_KIT'][self.variant]
        self.kit_right=None if k is None else (bool(self.p['anti_dragon_gear'])==k)
        if c['PARTIAL_KIT']:
            right=(c['KIT_RIGHT_NODRAGON'] or c['KIT_RIGHT_FRAC'])[self.variant] if not self.p['dragon'] else c['KIT_RIGHT_FRAC'][self.variant]
            if force=='right' or (force is None and self.p.get('adaptive') and self.intel):self.kit_frac=right
            elif force=='wrong':self.kit_frac=c['KIT_WRONG_NODRAGON'] if (c['KIT_WRONG_NODRAGON'] is not None and not self.p['dragon']) else c['KIT_WRONG_FRAC']
            elif self.p.get('adaptive'):self.kit_frac=c['KIT_NOINTEL_FRAC']
            else:self.kit_frac=max(self.kit_frac or 0,self.p.get('kit_frac',.33 if self.p.get('anti_dragon_gear') else 0))
            self.kit_right=abs(self.kit_frac-right)<=c['KIT_TOL']
    def foregone_rounds(self,d):
        """C2: rounds for an unopposed evil dragon dealing d per round to destroy the Town Center, using the replay's allocation."""
        fort,town,n=self.fort,self.town,0
        while town>0 and n<10**6:
            n+=1
            if self.c['B7_WALLS']:
                to_wall=min(fort,.7*d) if fort>0 else 0;rest=d-to_wall;fort-=to_wall
                if fort<=0:town-=rest
            else:
                spill=max(0,d-fort);fort=max(0,fort-d)
                if fort<=0:town-=spill
        return n
    # ---------- equipment (A6)
    def vcost(self,tiers,soldiers,rate):
        lo=min(tiers,2);hi=max(0,tiers-2);d={}
        if lo:d['timber']=rate*lo*soldiers
        if hi:d['gear']=rate*hi*soldiers
        return d
    def gear_upkeep(self):
        c=self.c;army=self.army()
        if not self.p['gear'] or not army:return
        if c['GEAR']=='village':
            up=self.vcost(max(0,self.vtiers-1),army,c['GEAR_UPKEEP'])
            if sum(up.values())>0 and not self.spend(up,True):self.vtiers-=1;self.skip_upgrades_until=self.day+1
            return
        need={'timber':0.,'gear':0.}
        for sd in self.soldiers:
            for tt in range(2,sd[1]+1):need[self.tier_material(tt)]+=c['GEAR_UPKEEP']
        need={k:v for k,v in need.items() if v>0}
        if not need:return
        if not self.spend(need,True):
            sd=max(self.soldiers,key=lambda x:(x[1],x[3]))
            if sd[1]>0:sd[1]-=1;sd[3]=self.day
            self.skip_upgrades_until=self.day+1
    def gear_purchases(self):
        c=self.c
        if self.day<self.skip_upgrades_until or not self.soldiers:return
        if c['GEAR']=='village':
            if self.vtiers<self.stage:
                new=self.vcost(self.vtiers+1,self.army(),c['GEAR_EQUIP']);old=self.vcost(self.vtiers,self.army(),c['GEAR_EQUIP'])
                if self.spend({k:v-old.get(k,0) for k,v in new.items() if v-old.get(k,0)>0},True,True):self.vtiers+=1
            return
        while True:
            cand=[sd for sd in self.soldiers if sd[1]<min(4,self.stage,self.p.get('max_tier',4))]
            if not cand:return
            sd=min(cand,key=lambda x:(x[1],x[2]))
            mat=self.tier_material(sd[1]+1);cost=c['GEAR_EQUIP']
            if mat=='gear' and self.s['gear']-cost<c['GEAR_RESERVE']-1e-9:return
            if not self.extra_ok({mat:cost}) or not self.spend({mat:cost},True,True):return
            sd[1]+=1;sd[3]=self.day
    def tier_counts(self):
        u=[0]*5
        for sd in self.soldiers:u[self.tier_of(sd)]+=1
        return u
    # ---------- combat
    def dragon_active(self,mobilized):return mobilized and self.hp>0 and self.hp>=self.c['WITHDRAW']*self.dmax()
    def roll(self):r=self.rng;return min(1.2,max(.8,(r.randint(1,6)+r.randint(1,6)+r.randint(1,6))/10.5))
    def fight(self,final,evil):
        if self.c['TARGET']=='fix2':return self.fight_fix2(final,evil)
        return self.fight_v3(final,evil)
    def setup_encounter(self,final,evil):
        c=self.c;r=self.rng;day=self.day
        if getattr(self,'force',None):   # test hook: (enemy, boss, kind, scout, mobilized, choice, fortune)
            return self.force
        enemy=(12+((c['FINAL_DAY'] or day) if final else day)*.105)*self.enemy_rng.uniform(*(c.get('FINAL_SPREAD') or c['SPREAD']) if final else c['SPREAD'])*self.difficulty*(c['FINAL'] if final else (c['RAID_LVL'][self.stage-1] if c['RAID_LVL'] else c['RAID']))
        boss=42*self.difficulty if evil else (42*self.difficulty*self.flier if (not final and self.flier) else 0)
        if not final and self.flier:enemy*=c['FLY_ESCORT']
        kind=self.enemy_rng.randrange(3)
        scout=r.randint(1,20)+(3 if 'scouting' in self.hero_names else 0)>=(18 if evil else 10)
        mobilized=self.hp>0 and self.favor>0
        if final and c['INVASION_MODEL']:
            v=c['VARIANTS'][self.variant];va,vb=v[0],v[1];self.wall_mult=v[2] if len(v)>2 else 1.0
            if c['COUNTER_MODEL']:
                cf=self.counter_fraction();self.counter=round(cf,3)
                if self.variant=='horde':va*=1+c['HORDE_BONUS']*(1-cf)
                elif self.variant=='wyrm':vb*=1+c['WYRM_BONUS']*(1-cf)
                elif self.variant=='siege':self.wall_mult*=1+c['SIEGE_WALL']*(1-cf)
            self.boss_var=vb*c['BOSS_MULT'];enemy*=va;boss*=vb*c['BOSS_MULT']
        choice=1.0
        if self.p['gear'] and any(self.tier_of(sd)>0 for sd in self.soldiers):
            if final and c['INVASION_MODEL']:
                choice=1.0 if self.kit_right is None else (c['GEAR_RIGHT'] if self.kit_right else c['GEAR_WRONG'])
            else:choice=c['GEAR_RIGHT'] if (scout or self.gear_rng.random()<.5) else c['GEAR_WRONG']
        fortune=1.0
        if c['FORTUNE']:
            roll3=sum(self.fortune_rng.randint(1,6) for _ in range(3));fortune=.85+.30*(roll3-3)/15
            self.fortune_log.append((day,final,roll3,round(fortune,3)))
        return enemy,boss,kind,scout,mobilized,choice,fortune
    def army_split(self,kind,choice,boss_alive,focus):
        """Return (field power, boss power) from soldiers (A4, A6)."""
        c=self.c;field=boss=0.
        mult=(1+self.vet*.02)*choice*(1+self.defense_bonus)
        if c['PARTIAL_KIT']:
            elig=sum(1 for sd in self.soldiers if self.tier_of(sd)>=c['KIT_TIER']);kits=round((self.kit_frac or 0)*elig);seen=0
        for sd in self.soldiers:
            t=self.tier_of(sd)
            gm=1+(sum(c['GEAR_TABLE'][:t]) if c['DR'] else c['GEAR_TIER']*t)
            pw=(soldier_power(sd[0])+c['B6_POWER']*1.4)*(1.3 if sd[0]==kind else 1)*gm*mult
            if c['PARTIAL_KIT']:
                ad=t>=c['KIT_TIER'] and seen<kits;seen+=int(t>=c['KIT_TIER'])
            else:ad=self.p['anti_dragon_gear'] and t>=4
            if boss_alive:
                share=(c['AD_SHARE'] if ad else (0.0 if c['AD_ONLY'] else c['PLAIN_SHARE']))*focus
                boss+=pw*share;field+=pw*(1-share)*(c['AD_ARMY'] if ad else 1)
            else:field+=pw*(c['AD_ARMY'] if ad else 1)
        return field,boss
    def fight_v3(self,final,evil):
        c=self.c;r=self.rng
        enemy,boss,kind,scout,mobilized,choice,fortune=self.setup_encounter(final,evil)
        initial=enemy;spilled=False;self.report=[]
        fly_start=boss if (not final and self.flier and boss>0) else 0;spill_total=0.
        if evil:self.boss_killed_by=None;self.boss_by={'dragon':0.,'ballista':0.,'army':0.,'walls':0.}
        buff=1+c['DEM_BUFF'] if self.day<=self.buff_until else 1
        sole=self.army()==0 and self.dragon_active(mobilized)
        focus=c['FOCUS_FULL'] if not self.dragon_active(mobilized) else c['FOCUS_SPLIT']
        pride=max(1-c['PRIDE_MAX'],1-c['PRIDE_STEP']*max(0,self.army()-(c['TOL_BASE']+c['TOL_LVL']*self.level))) if (final and c['PRIDE']) else 1
        hoard=1+min(c['HOARD_CAP'],self.hoard/c['HOARD_SCALE']) if (final and c['HOARD']) else 1
        tol=c['TOL_BASE']+c['TOL_LVL']*self.level;army0=self.army();boss_start=boss
        held=bool(evil and c['ENTRY'] and army0>tol and self.dragon_active(mobilized))
        if evil and self.dragon_active(mobilized):self.duel=dict(entered=False,round=None,boss_at_entry=None,dragon_at_entry=None,army_at_entry=None,winner='none',held=held)
        idle=0
        for rnd in range(c['HARD_CAP']):
            sig=(round(enemy,9),round(boss,9),round(self.fort,9),round(self.town,9),self.army(),round(self.hp,9))
            if held:
                if (c['ENTRY']=='A' and self.army()<=tol) or (c['ENTRY']=='D' and (self.army()<=(1-c['ENTRY_LOSS'])*army0 or self.fort<=0)):held=False
            act=self.dragon_active(mobilized) and not held
            if evil and c['ENTRY']:focus=c['FOCUS_SPLIT'] if act else c['FOCUS_FULL']
            if self.duel and act and not self.duel['entered'] and boss>0:
                boss=max(boss,c['SECOND_WIND']*boss_start)
                self.duel.update(entered=True,round=rnd+1,boss_at_entry=round(boss,2),dragon_at_entry=round(self.hp,2),army_at_entry=self.army())
            dpow=(c['DPOW_TABLE'][self.level-1] if c['DR'] else self.level*c['DPOW_LVL']+c['DPOW_BASE'])*(self.hp/self.dmax())*(.65+self.favor/135)*buff*(1+c['SOLE_RAID'] if sole and not evil else 1)*pride*hoard if act else 0
            log={'round':rnd+1};dueled=False
            # --- boss phase: ballistae, then duel (simultaneous), then soldiers' boss share
            boss_at_volley=boss>0   # C1
            boss_round_start=boss
            if boss>0:
                if self.ballistae:
                    shots=min(self.ballistae,int(self.bolts));self.bolts-=shots
                    d=(shots*c['BOLT_DMG']+(self.ballistae-shots)*c['BALLISTA_BASE'])*focus*fortune
                    self.boss_by['ballista']+=min(boss,d);boss=max(0,boss-d);log['ballista>boss']=d
                    if boss<=0 and not self.boss_killed_by:self.boss_killed_by='ballista'
                if boss>0 and dpow:
                    bscale=self.flier if fly_start else (self.boss_var if (c['INVASION_MODEL'] and self.variant) else 1)
                    hit=2.6*(.55*42*self.difficulty*bscale+.45*boss)*.21*(1+c['WEAK_DUEL']*(4-self.level))
                    edge=(1+max(-1,min(1,(self.favor-50)/50))*c['DUEL_FAVOR'])*(1+c['DUEL_RESERVE'] if all(v>=.5*(18+4*self.level) for v in self.reserves.values()) else 1)
                    d=dpow*self.roll()*edge*(1+c['SOLE_DUEL'] if sole else 1)*fortune
                    taken=hit*(1-c['HIDE']*r.randint(1,4));dueled=True
                    self.boss_by['dragon']+=min(boss,d);boss=max(0,boss-d);self.hp=max(0,self.hp-taken)   # simultaneous
                    log['dragon>boss']=d;log['boss>dragon']=taken
                    if boss<=0 and not self.boss_killed_by:self.boss_killed_by='dragon'
            boss_alive=boss>0
            field,bpow=self.army_split(kind,choice,boss_alive,focus)
            sroll=self.roll()
            if boss_alive and bpow:
                d=bpow*sroll*fortune;self.boss_by['army']+=min(boss,d);boss=max(0,boss-d);log['soldiers>boss']=d
                if boss<=0 and not self.boss_killed_by:self.boss_killed_by='army'
            if fly_start and boss>0:
                if boss>=boss_round_start-1e-9:   # nobody hurt it this round: it burns stores and harries the army
                    for k in ('food','timber','stone'):self.s[k]*=1-c['FLY_BURN']
                    if self.army():self.wounded+=c['FLY_WOUND']
                if boss<=c['FLY_RETREAT']*fly_start or rnd+1>=c['FLY_ROUNDS']:boss=0.
            # --- field phase (simultaneous exchange)
            act=self.dragon_active(mobilized) and not held
            dfield=dpow if (act and boss<=0 and not dueled) else 0   # one allocation per source per round
            mobile=field+dfield
            soldiers_now=self.army();standing=soldiers_now>0 or act or self.fort>0
            heroes_fire=self.heroes*c['HERO_FIRE'] if standing else 0
            walls_fire=min(c['WALL_FIRE_CAP'],c['WALL_FIRE']*self.fort)
            ball_field=self.ballistae*c['BALLISTA_BASE'] if (self.ballistae and not boss_at_volley) else 0   # C1
            tower_fire=self.towers*c['TOWER_FIRE']*(c['SIEGE_TOWER'] if (final and c['COUNTER_MODEL'] and self.variant=='siege') else 1) if self.fort>0 else 0
            # Keep the same roll order and damage formula while recording the actual field exchange.
            dragon_strike=dfield*self.roll() if enemy>0 else 0
            out=(field*sroll+dragon_strike+heroes_fire+walls_fire+ball_field+tower_fire)*fortune if enemy>0 else 0
            enemy_before=enemy
            incoming=max(0,enemy)*.42*self.roll()+(boss*c['BOSS_PRESSURE'] if (boss>0 and not act) else 0)
            if self.duel and self.duel['entered'] and self.duel['winner']=='none':
                if boss<=0 and self.boss_killed_by=='dragon':self.duel['winner']='your dragon'
                elif boss<=0:self.duel['winner']='finished by others'
                elif self.hp<=0 or not self.dragon_active(mobilized):self.duel['winner']='evil dragon'
            log.update({'soldiers>field':field*sroll*fortune,'dragon>field':dfield,'heroes>field':heroes_fire*fortune,'walls>field':walls_fire*fortune,'ballista>field':ball_field*fortune,'incoming':incoming})
            # apply both sides
            enemy=max(0,enemy-out)
            if enemy<c['EPS']:enemy=0
            if self.log_rounds:
                log.update({'dragon>field_rolled':dragon_strike*fortune,'enemy_before':enemy_before,
                            'enemy_after':enemy,'field_damage':out})
            if boss<c['EPS']:boss=0
            breach=max(0,incoming-mobile)
            if c['B7_WALLS']:
                to_wall=min(self.fort,.7*breach) if self.fort>0 else 0
                rest=breach-to_wall
                contact=min(incoming,mobile)
                self.wounded+=contact*field/max(.01,mobile) if mobile else 0
                if mobile>field and act:self.hp=max(0,self.hp-contact*(mobile-field)/mobile*(1-c['HIDE']*r.randint(1,4)))
                self.fort=max(min(1,self.fort) if self.stage==1 else 0,self.fort-to_wall)
                if rest>0:
                    if self.army():self.wounded+=rest
                    elif self.fort>0:self.civ=min(100,self.civ+rest)
                    elif not self.dragon_active(mobilized):self.town=max(0,self.town-rest);spilled=True
                    else:self.hp=max(0,self.hp-rest)
                spilled|=rest>0
            else:
                exposed=max(0,incoming-mobile-self.fort)
                contact=min(incoming,mobile)+.5*exposed
                self.wounded+=contact*field/max(.01,mobile) if mobile else 0
                if mobile>field and act:self.hp=max(0,self.hp-contact*(mobile-field)/mobile*(1-c['HIDE']*r.randint(1,4)))
                wb=breach*(self.wall_mult if final else 1)
                spill=max(0,wb-self.fort);spilled|=spill>0;spill_total+=spill
                self.civ=min(100,self.civ+c['CIV_SHARE']*breach)
                self.fort=max(min(1,self.fort) if self.stage==1 else 0,self.fort-wb)
                gone=not self.dragon_active(mobilized)
                if self.army()==0 and gone and self.fort<=0:self.town=max(0,self.town-spill)
                elif c['SPILL_ARMY'] and spill>0 and self.army():self.wounded+=spill   # run 9: overflow past fallen walls wounds soldiers instead of vanishing
            while self.wounded>=8 and self.soldiers:
                self.remove_soldier();self.people-=1;self.field_losses+=1;self.wounded-=8
            if self.fort<=0:self.ballistae=0;self.towers=0;self.fort_peak=0.
            if self.log_rounds:self.report.append(log)
            if self.town<=0:self.cause='Town Center destroyed';return 'defeat'
            idle=idle+1 if (round(enemy,9),round(boss,9),round(self.fort,9),round(self.town,9),self.army(),round(self.hp,9))==sig else 0
            if idle>=c['ROUND_LIMIT']:break
            if boss<=0 and (enemy<=0 or (not final and enemy<=initial*(1-(.4,.6,.75,.9)[self.stage-1]))):
                self.vet=min(3,self.vet+1);self.xp+=int(mobilized);self.wounded=0
                if spilled and not final and c['LEVEL_LOSS']:
                    self.raids_breached+=1
                    if self.stage>=2 and self.l2_grace:self.l2_grace=False
                    elif self.stage>=2:
                        n=min(3 if self.stage<4 else 2,int(-(-spill_total//c['LOSS_PER'])));self.lost_levels+=n;self.levels_lost_total+=n
                elif not final and self.stage>=2 and c['LEVEL_LOSS']:self.l2_grace=False
                if spilled and not final:
                    for k,v in c['RESERVE'].items():
                        take=max(0,self.s[k]-v*self.stage)*c['PLUNDER'];self.s[k]-=take;self.plundered+=take*VALUE[k]
                return 'won'
            # A5 shortcut: lone evil dragon, nothing can damage it
            if c['SHORTCUT'] and not fly_start and boss>0 and enemy<=0 and not self.army() and not self.dragon_active(mobilized) and not self.ballistae and boss*.35>0:
                d=boss*.35;rounds=self.foregone_rounds(d)   # C2
                self.cause=f'evil dragon unopposed; Town Center falls in {rounds} more rounds';self.town=0;return 'defeat'
        self.stall_state=dict(day=self.day,final=final,enemy=enemy,boss=boss,army=self.army(),hp=self.hp,fort=self.fort,town=self.town,ballistae=self.ballistae,bolts=self.bolts)
        self.cause='stall';return 'stall'
    def fight_fix2(self,final,evil):
        """engine_fix2 combat, kept for the order-only comparison (walls add to boss damage; no duel assist)."""
        c=self.c;r=self.rng
        enemy,boss,kind,scout,mobilized,choice,fortune=self.setup_encounter(final,evil)
        initial=enemy;spilled=False
        buff=1+c['DEM_BUFF'] if self.day<=self.buff_until else 1
        army=self.army();sole=army==0 and self.dragon_active(mobilized)
        focus=c['FOCUS_FULL'] if not self.dragon_active(mobilized) else c['FOCUS_SPLIT']
        ad=self.p['anti_dragon_gear'] and self.vtiers>=4
        share=(c['AD_SHARE'] if ad else c['PLAIN_SHARE'])*focus
        for turn in range(c['ROUND_LIMIT']):
            dueling=boss>0;act=self.dragon_active(mobilized)
            dragon=(self.level*c['DPOW_LVL']+c['DPOW_BASE'])*(self.hp/self.dmax())*(.65+self.favor/135)*buff*(1+c['SOLE_RAID'] if sole and not evil else 1) if act else 0
            gmul=(1+c['GEAR_TIER']*self.vtiers)*choice*(c['AD_ARMY'] if ad else 1)
            power=sum(n*soldier_power(i)*(1.3 if i==kind else 1) for i,n in enumerate(self.units()))*(1+self.vet*.02)*gmul*(1+self.defense_bonus)
            mobile=power+(dragon if boss<=0 else 0)
            incoming=max(0,enemy)*.42*self.roll();outgoing=mobile*self.roll()+min(c['WALL_FIRE_CAP'],c['WALL_FIRE']*self.fort)+(self.heroes*.4 if mobile or self.fort else 0)
            if boss>0 and self.ballistae:
                shots=min(self.ballistae,int(self.bolts));self.bolts-=shots
                d=(shots*c['BOLT_DMG']+(self.ballistae-shots)*c['BALLISTA_BASE'])*focus
                self.boss_by['ballista']+=min(boss,d);boss=max(0,boss-d)
                if boss<=0:self.boss_killed_by='ballista'
            if boss>0:
                if dragon:
                    hit=2.6*(.55*42*self.difficulty+.45*boss)*.21*(1+c['WEAK_DUEL']*(4-self.level))
                    self.hp=max(0,self.hp-hit*(1-c['HIDE']*r.randint(1,4)))
                    edge=(1+max(-1,min(1,(self.favor-50)/50))*c['DUEL_FAVOR'])*(1+c['DUEL_RESERVE'] if all(v>=.5*(18+4*self.level) for v in self.reserves.values()) else 1)
                    d=dragon*self.roll()*edge*(1+c['SOLE_DUEL'] if sole else 1);self.boss_by['dragon']+=min(boss,d);boss=max(0,boss-d)
                    if boss<=0:self.boss_killed_by='dragon'
                else:
                    incoming+=boss*.35
                    hit=outgoing*share;self.boss_by['army']+=min(boss,hit);boss=max(0,boss-hit);outgoing-=hit
                    if boss<=0 and not self.boss_killed_by:self.boss_killed_by='army'
            exposed=max(0,incoming-mobile-self.fort);contact=min(incoming,mobile)+.5*exposed
            self.wounded+=contact*power/max(.01,mobile)
            if not dueling and mobile>power:
                self.hp=max(0,self.hp-contact*(mobile-power)/mobile*(1-c['HIDE']*r.randint(1,4)))
            while self.wounded>=8 and self.soldiers:
                self.remove_soldier();self.people-=1;self.field_losses+=1;self.wounded-=8
            breach=max(0,incoming-mobile);spill=max(0,breach-self.fort)
            self.civ=min(100,self.civ+c['CIV_SHARE']*breach);spilled|=spill>0
            self.fort=max(min(1,self.fort) if self.stage==1 else 0,self.fort-breach)
            if self.fort<=0:self.ballistae=0
            gone=not self.dragon_active(mobilized)
            if self.army()==0 and gone and self.fort<=0:self.town=max(0,self.town-spill)
            enemy=max(0,enemy-outgoing)
            if self.town<=0:self.cause='Town Center destroyed';return 'defeat'
            if final and self.fort<=0 and self.army()==0 and gone and (enemy>0 or boss>0):
                self.town=0;self.cause='undefended invasion (FIX-2 shortcut)';return 'defeat'
            if boss<=0 and (enemy<=0 or (not final and enemy<=initial*(1-(.4,.6,.75,.9)[self.stage-1]))):
                self.vet=min(3,self.vet+1);self.xp+=int(mobilized);self.wounded=0
                if spilled and not final:
                    for k,v in c['RESERVE'].items():
                        take=max(0,self.s[k]-v*self.stage)*c['PLUNDER'];self.s[k]-=take;self.plundered+=take*VALUE[k]
                return 'won'
        self.cause='stall';return 'stall'
    # ---------- campaign
    def snapshot(self):
        return dict(day=self.day,wave=self.wave,soldiers=self.army(),tiers=self.tier_counts(),dragon_level=self.level,dragon_hp=round(self.hp,3),
                    favor=round(self.favor,3),fort=round(self.fort,3),ballistae=self.ballistae,bolts=round(self.bolts,3),
                    town=round(self.town,3),heroes=self.heroes,people=self.people,civ=round(self.civ,3),food=round(self.s['food'],3),timber=round(self.s['timber'],3),gear=round(self.s['gear'],3))
    def play(self,days=700,on_final=None):
        for self.day in range(1,days+1):
            self.tick()
            if self.people<=0 and not self.recruit and self.s['food']<4:self.cause='famine';return 'famine'
            final=self.next_wave==self.day
            if not final:
                if self.day!=self.next_raid:continue
                if self.stage==4 and not (self.c['RAID_GAPS'] and self.wave==0 and self.next_wave and self.day<=self.next_wave-self.c['RAID_STOP']):
                    if self.c['RAID_GAPS']:self.next_raid=self.day+self.c['RAID_GAPS'][3]
                    continue
            if final:
                self.wave+=1;self.next_wave=self.day+self.c['GAP'];self.waves.append(self.snapshot())
                if self.wave==1:self.dspend_pre=self.dspend
                if on_final:on_final(self)
            else:self.raids+=1;self.next_raid=self.day+(self.c['RAID_GAPS'][self.stage-1] if self.c['RAID_GAPS'] else 25)
            stage_before=self.stage
            c=self.c
            if not final and c['FLYERS'] and self.stage==4 and self.next_wave and self.day<=self.next_wave-c['FLY_STOP']:
                self.flier=c['FLY_STR'][min(self.fly_raids,len(c['FLY_STR'])-1)];self.fly_raids+=1
            outcome=self.fight(final,self.wave==3)
            if self.flier:
                if c['LEARN'] and self.p.get('learns') and not self.learned:
                    self.learned=True;self.kit_frac=max(self.kit_frac or 0,c['LEARN_KIT']);self.p['bolts_target']*=c['LEARN_BOLTS'];self.p['ballistae']=True
                    if c['PARTIAL_KIT'] and self.variant:self.kit_right=abs(self.kit_frac-((c['KIT_RIGHT_NODRAGON'] or c['KIT_RIGHT_FRAC'])[self.variant] if not self.p['dragon'] else c['KIT_RIGHT_FRAC'][self.variant]))<=c['KIT_TOL']
                self.flier=0.
            if self.p['walls'] and self.fort<=0 and self.stage>=self.p['walls_from']:self.wall_down_until=self.day+self.c['REBUILD']
            if outcome!='won':self.lost_stage=stage_before;return outcome
            if self.wave==3:return 'victory'
        return 'horizon'
