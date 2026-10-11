# التقرير الموحّد — Mario-Kart (Basem321/Mario-Kart)

*10 أكتوبر 2026 · دمج تقريري مع `mario-kart-full-report.md` المرفوع، من غير تكرار وبترتيب الأولويات*

## 0. التغطية والرموز (اقرأ ده الأول)

**ماقريتش الـ 16 ألف سطر كلهم.** أنا قريت حوالي 10 آلاف سطر من كود JS/JSX الأساسي، وشغّلت اللعبة في Chromium headless بدون إنترنت خارجي وبدون GPU (حوالي 1 فريم/ثانية)، وحلّلت ملفات الـ GLB للخرائط الثلاث. التقرير المرفوع بيقول إنه غطّى حوالي 92%، ومقدرش أتحقق من الرقم ده.

- **\[✔\]** مؤكد بتشغيل فعلي أو بحساب على الـ GLB أو بتشغيل دوال الكود الحقيقية.
- **\[◐\]** مؤكد بقراءة الكود بنفسي (ماجرّبتوش بالتشغيل).
- **\[○\]** من التقرير المرفوع بس، ومش متحقق منه (الملف ماقريتوش بنفسي).

**حدود الاختبار:** ماقدرتش أقيّم إحساس الفيزياء، ولا أجرّب الأونلاين (PeerJS محتاج إنترنت)، ولا أشغّل Waluigi وShroom Ridge تشغيل كامل.

## 1. أخطاء حرجة / عالية

1. **الأونلاين من غير TURN \[◐\]:** `useP2PLobby.js:630` و`:823` بينشئوا `new Peer()` من غير `iceServers`، وبيعتمدوا على PeerJS cloud العام. بين شبكتين مختلفتين الاتصال غالباً بيفشل، وده أرجح سبب لمشكلة الأونلاين. ومفيش معالجة لـ `peer.on('disconnected')`.
2. **الاعتماد على CDN خارجي = شاشة بيضاء \[✔\]:**
   - الـ Draco decoder بيتحمّل من `gstatic.com` رغم `setDecoderPath('/draco/')` في `main.jsx:43`، لأن `useGLTF.preload` في `ItemBoxes.jsx:1700` و`BVHEnsure.jsx:62` و`TrackWalls.jsx:335` (وكمان `Kart` و`Driver` و`Pickups`) بتتنفذ وقت الـ import قبله. في الـ run: 118 خطأ `Failed to fetch`، و`walls:0` و`pos:null`.
   - الـ HDR بيتحمّل من `raw.githack.com` (`misc/EnvironmentSphere.jsx:34`)، وفشله بيوقّع الـ Canvas كله.
   - Google Fonts عن طريق `@import`.
   - مفيش `ErrorBoundary` خالص، فأي فشل = شاشة بيضاء (الـ screenshot طلع أبيض).
   - **الإصلاح اتجرّب:** لما نقلت `setDecoderPath` لملف بيتحمّل أول واحد وشلت preset الـ HDR، الماب اتحمّلت offline.
   - ادّعاء الـ README إنها بتشتغل offline غلط.
3. **اللفّات بتتحسب من غير checkpoints \[◐\]:** `FinishLine.jsx:163-169` بيشترط بس: ابعد 28 وحدة، وعدّي الخط للأمام، ومرّ 3 ثواني. ترجع لورا وتعدّي تاني وتاخد لفة. و`checkpoints` الموجودة في الإعدادات مش بتتستخدم في العد.
4. **`race:progress` من غير تحقق من المعقولية \[◐\]:** `useP2PLobby.js:317` بيتأكد إن الأرقام متسقة بس، فأي peer يقدر يبعت `finished:true` فوراً.
5. **أحداث أونلاين بتتطبّق من أي peer من غير تحقق من المرسل \[◐\]:** `bomb:explode` و`blue:explode` و`item:boxes` و`item:boxTaken` (`ItemBoxes.jsx:871-1019`). peer ضار يقدر يعمل stun-lock للاعب بإرسال انفجارات على مكانه (مواقع اللاعبين بتتبث للكل)، أو يمسح الصناديق للكل. على عكس `shell:hit` و`bullet:knock` اللي متأمّنين صح، و`blooper:ink` اتصلّح فيه `raceLive()` حسب التقرير المرفوع.
6. **ترتيب النهاية غلط للاعب المحلي \[◐ — الاتنين\]:** صف `isSelf` مفيهوش `completedAt` فبيبقى `Infinity` (`RaceResults.jsx` و`OnlineRaceLeaderboard.jsx`). لو خلّصت أول بنفس عدد اللفّات، ترتيبك بينزل لما الباقيين يخلّصوا بعدك (VICTORY تبقى FINISHED 2ND). كمان الـ leaderboard بيرتّب بـ `completedAt` وترتيب الغرفة بينما الـ HUD والعناصر بيرتّبوا بالمسافة المقطوعة (odometer)، فممكن يظهروا ترتيبين مختلفين. والـ odometer بيتحسب من أي حركة (حتى الرجوع) فمش مقياس تقدّم.
7. **العناصر ما تتستخدمش على الموبايل ولا الذراع \[◐ — الاتنين\]:** الاستخدام بيقرا `keys.dropBomb || keys.useItem` (كيبورد بس، `ItemBoxes.jsx:1247`). الموبايل فيه joystick وزر A (drift) بس، والذراع مفيهوش ربط للعناصر. لاعب الموبايل يلقط عنصر ومايقدرش يستخدمه والـ slot يفضل مشغول.
8. **اللابتوبات بشاشة لمس بتتسارع تلقائي \[◐\]:** `useTouchScreen` بيرجع true لو `maxTouchPoints > 0`، و`PlayerController.jsx:639-643` بيخلي الكارت يتسارع دايماً، فلاعب الكيبورد على Surface مايقدرش يوقف. وبتظهر له أزرار الموبايل.
9. **الـ Pause مش بيوقف اللعبة \[◐ — الاتنين\]:** القايمة مكتوب عليها GAME PAUSED بس مفيش `isPaused` في أي ملف؛ الكارت والتايمر والقذائف بيكملوا والمفاتيح شغالة.
10. **«Race Again» مابيرجّعش الكارت للـ grid \[◐\]:** `startGame` بيصفّر الـ store بس (`resetBattleState`)، ومفيش كود بيرجّع موقع الكارت وسرعته وحالة الـ drift/turbo لسباق جديد من غير reload.
11. **كراش الـ gamepad \[◐ — الاتنين\]:** `buttons[5].pressed || buttons[7].pressed` (`PlayerController.jsx:915`) بيرمي `TypeError` لو الذراع أقل من 8 أزرار ويكسر الـ `useFrame`. كمان `axes[0]` من غير deadzone (انحراف الـ stick بيلف الكارت)، و`gamepads[0]` بس هو اللي بيتقرا. الحل: `buttons[5]?.pressed` + deadzone.
12. **بداية السباق:**
    - `startsAt: Date.now()+900` بساعة الـ host والـ guest بيحسب بساعته، فأي فرق ساعات = بداية غير متزامنة \[◐ — الاتنين\].
    - العدّ التنازلي بمؤقتات wall-clock مش مربوط بتحميل الماب: في Shroom Ridge كان `gameStarted=true` و`pos` لسه `null` حوالي 18 ثانية \[✔\].
    - مفيش فحص `gameStarted` في `useFrame` بتاع `PlayerController`، فالكارت ممكن يتحرك أثناء 3-2-1 \[◐، ماقدرتش أجرّبه بالتشغيل\].
13. **الـ Canvas كله بيعيد render كل فريم \[◐ + ✔\]:** `updateLapTime` بيعمل `set` كل فريم، و`Root` (`main.jsx`) و`LoadingScreen` و`GameUI` و`GameReadyCheck` بيشتركوا في `useGameManager()` من غير selector. شفت `LoadingScreen render` 24 مرة أثناء التحميل. تعليق `GameUI.jsx:150` اللي بيقول 10Hz غير دقيق.
14. **الكروت البعيدة بتظهر في مكان غلط 5× في Shroom Ridge \[◐\]:** `RemoteRacers.jsx:99-101` بيعمل `position = damp(position*rs, target)/rs`، لكن `position` الـ group في إحداثيات الـ parent ومش بيتأثر بـ scale الـ group نفسه (`kartScale = 0.2`). الكارت المحلي سليم.
15. **خط النهاية بيطفو على ارتفاع غلط \[✔\]:** `FinishLine.jsx` بيرمي ray من y=60 وياخد أول mesh اسمه ground. حسبتها على الـ GLB: **Waluigi** أول ضربة y=16.10 (`Object_59`) والطريق عند -1.67 يعني حوالي 17.8 وحدة فوق الطريق. **Shroom Ridge** أول ضربة y=1.95 (البوابة `Object_55`) يعني حوالي 3.6 فوق الطريق. Mario Circuit سليمة. (كشف اللفة نفسه XZ فبيشتغل، المشكلة بصرية.)
16. **سرعة الـ Time Trial مضروبة مرتين \[◐\]:** `speedFactor` 1.5 (`PlayerController.jsx:617`) و`movementFactor` 1.5 (سطر 752 و832)، فالكارت 2.25× والـ HUD بيعرض 1.5×.

## 2. الفيزياء والماب

1. **Mario Circuit مفيهاش حيطان على حواف الطريق \[✔\]:** الـ log قال `road boundary segments: 0, total with outer fence: 4`. السبب إن الـ road mesh non-manifold: من 12,111 حافة فريدة، **10,959** مشتركة بين أكتر من مثلثين، فمفيش ولا حافة بعدد 1. التصادم بيعتمد على الـ raycast الأفقي على meshes اسمها ground (وده غالباً شغال)، لكن **القواقع** بتستخدم `wallSegments` (4 بس) فبتعدّي من الحواجز.
2. **Shroom Ridge قريبة من حد الـ downsampling \[✔\]:** عدد الحيطان بعد الفلاتر 2438 والحد 2496 (هامش 58 segment بس)، وأي تعديل صغير هيخلّي الكود يمسح كل N-th segment ويعمل فجوات صامتة (`TrackWalls.jsx:228-231`). Waluigi حوالي 1339 قبل الفلاتر.
3. **عتبات متضاربة \[◐\]:** الحائط `|n.y| ≤ 0.35` (`PlayerController.jsx:459`) والأرضية `n.y ≥ 0.15` في Mario/Shroom و`≥ 0.4` في Waluigi (`Kart.jsx:247`). أسطح 0.15-0.35 أرضية وحائط معاً، وأسطح 0.35-0.4 في Waluigi لا أرضية ولا حائط.
4. **أشياء بتتغيّر مع الـ FPS \[◐\]:** `maxClimb`/`maxDrop` لكل فريم مش لكل ثانية (`Kart.jsx:389, 445`)؛ لفّة العجلات `rotation.x += speed*0.01` من غير `delta` (`Kart.jsx:218-222`)؛ تباطؤ الاحتكاك بالحيط `speedRef.current *= factor` كل فريم (`PlayerController.jsx:877`، على 144Hz الكارت بيقف أسرع بكتير من 60Hz).
5. **الـ Spin-out \[◐ — الاتنين\]:** `Kart.jsx:747-760` بيحط العجلات في إحداثيات ثابتة والـ body على `y=0`، فعلى deck مرتفع الكارت بينزل لـ y=0 وبعدين يطلع 0.35/فريم. وكمان وقت الـ spin بيتخطّى `getGroundPosition` فـ `groundPosition` (اللي بتستخدمه القوقعة الزرقاء والأسوار) والتراب وعلامات الدرفت بيفضلوا على آخر قيمة.
6. **`pitch` مش مقسوم على قاعدة العجلات \[◐\]** (`Kart.jsx:541`)، فالكارت الصغير (scale 0.2) بيميل أقل بـ 5×.
7. **Auto-Lakitu false positive \[◐\]:** شرط الزحف `|speed| < 2` (`PlayerController.jsx:336`) مش مضروب في `kartScale`. في Shroom Ridge السرعة القصوى 6، فبطء عادي في لفة تحت طريق تاني (أعلى بـ 5 وحدات) بيعمل teleport بعد 2.5 ثانية.
8. **الرجوع التلقائي ناقص \[◐\]:** `detectLostOffMap` بيرجع فوراً لو مفيش `checkpoints` (مقصود بتعليق في الكود عشان قفزة Waluigi)، فMario وWaluigi مفيهمش rescue للضياع على الأرض غير زر R. والنزول في الفراغ متغطّي في `Kart.jsx` (`y < -25` أو هوا أكتر من `MAX_AIR_TIME + 0.6`).
9. **زر R \[◐ — الاتنين\]:** بيروح لأقرب checkpoint مش آخر واحد عدّى عليه، وبلا cooldown، فممكن يتستغل كاختصار. الـ fallback (`PlayerController.jsx:307`) بيرجع دايماً لـ spawn رقم 0 من غير تعديل الاتجاه. وcheckpoints Waluigi موجودة في الـ JSON بس مش في `tracks.js` (فمش بتتستخدم).
10. **`isOffRoad` بيتجاهل الارتفاع \[◐\]:** الكارت تحت كوبري بيتعتبر على الطريق (`trackRoad.js`).
11. **الالتقاط والانفجارات XZ بس من غير ارتفاع \[◐\]:** صناديق العناصر (`ItemBoxes.jsx:1142`)، القنابل (سطر 1351)، وblast الانفجار (`PlayerController.jsx:129`). على الخرائط متعددة الطوابق بتلقط أو تتضرب من طابق فوقك أو تحتك.
12. **`resolveMeshWalls` بـ ray واحد على ارتفاع واحد \[◐\]** (`groundY + 0.25`)، فبيفوّت الحيطان الواطية والاحتكاك الجانبي. وبيخلق `Vector3` كل فريم.
13. **كل الـ meshes في Shroom Ridge اسمها ground \[◐\]** (شجر 57k مثلث، زهور 73k)، فالـ ray الأفقي ممكن يصطدم بالنباتات.
14. **`getMeshColliders` بيخزّن القايمة مرة واحدة حتى لو فاضية \[○، تحليلي إنه غالباً سليم في التدفق الحالي\]:** لو اتنادى قبل تحميل الـ track التصادم بيتعطّل طول السباق.
15. **`BoostPads` \[○\]:** المجسم بيدور لكن اختبار الاصطدام بيتجاهل الدوران، فالـ pad بتشتغل في مستطيل غير اللي بتشوفه.
16. **الـ blue shell على الأسطح المرتفعة \[◐\]:** `ItemBoxes.jsx:1486, 1501` بيستخدموا `r.y` (= `player.position.y` = 0 دايماً) بدل `bodyY` للاعبين البعيدين، فالقذيفة بتنزل على ارتفاع غلط.
17. **عناصر Shroom Ridge مش مضروبة في `kartScale` \[✔ حساب\]:** القذيفة الحمراء 48 والزرقاء 66 و`hitRadius` 3.4 و`lockRange` 60 وblast radius 8 و`BULLET_KNOCK_RADIUS` 3.5 (`itemConfig.js:57-63`، `homing.js:13,20`) بينما أقصى سرعة للكارت 6. يعني القذيفة 8× أسرع من الكارت وبتضرب من مسافة حوالي 17 ضعف نصف قطره. القنابل وpickups بس هي المتحجّمة.
18. **`isOffRoad`/تصادم القذيفة:** `wallHitNormal` بيلف على كل الـ segments كل فريم لكل قذيفة، من غير فلتر ارتفاع. ارتداد القذيفة نفسه شغّال (اختبرته بالدوال الحقيقية من 90° لـ 4°).
19. **كل الـ meshes `DoubleSide`** (`Track.jsx`)، وأحجام المشاهد ثقيلة: Mario Circuit 460 ألف مثلث، Shroom Ridge 305 ألف، Waluigi حوالي 253 ألف (فيها meshes مكررة، `Track.jsx` بيدمجها).

## 3. الأونلاين والأمان

1. **مفيش حد أقصى للاعبين، و`lobby:join` بيتقبل أثناء سباق شغال \[◐ — الاتنين\]** (`useP2PLobby.js:675`، `LobbyScreen.jsx:52`). والـ spawn slots 10 بس؛ اللاعب 11+ بيرجع للـ grid الافتراضي بـ scale 1 وزاوية 0 (غلط في Shroom Ridge)، وألوان الـ minimap 6 بس.
2. **مفيش rate limiting \[◐ — الاتنين\]:** كل حدث بيتبثّ للكل (O(N²) على uplink الـ host، حوالي 2 Mbps لـ 10 لاعبين)، ومفيش حد لعدد `shell:fired` و`bomb:dropped` من نفس اللاعب، فالمصفوفات `activeShells` و`droppedBombs` ممكن تتضخّم \[○\].
3. **`shell:fired` \[◐/○\]:** `dx` و`dz` و`top` مش مقيّدين (بس finite)، فقيمة ضخمة تنتج NaN/Infinity. وحقل `ownerId` بيتاخد من الـ payload من غير مقارنة بهوية المرسل (شكلي بس، لأن `shell:hit` متأمّن) \[○\].
4. **`item:boxes` فاضي \[◐\]:** القايمة الفاضية `[]` truthy فبتمسح كل الصناديق عند الكل.
5. **الساعات \[◐ — الاتنين\]:** `bombAgeMs` بيستخدم `Date.now() - createdAt` (ساعة المرسل)، فالقنبلة بتتسلّح فوراً أو متأخر. و`Date.now` مستخدم في 16 مكان مع `performance.now` \[○\].
6. **القوقعة الزرقاء \[◐\]:** لو الرامي هو الأول، `fireBlueShell` بيختار أول منافس مش خالص مش أقواهم ترتيباً.
7. **الـ host لو خرج الغرفة بتنتهي \[◐ — الاتنين\]**، ومفيش host migration.

## 4. العناصر والصوت والـ UI

1. **الأصوات بتتجاهل `sfxVolume` \[◐ — راجعتها\]:** الانفجار `volume = 1` والـ blue alarm 0.6 والـ spin 0.9 وصوت القنبلة 0.35، كلها ثابتة (`ItemBoxes.jsx` و`PlayerController.jsx:152`).
2. **أيقونات الـ HUD \[◐ — الاتنين\]:** الفطر الذهبي وskid وwind كلهم بنفس صورة الفطر العادي (`GameUI.jsx`)، فالـ emoji fallback مش بيشتغل أبداً. والـ triple red مفيهوش عداد للشحنات المتبقية (الفطر بس).
3. **جينجل النتيجة بيتقطع \[◐\]:** الـ cleanup بيشتغل كل ما `selfRank` يتغير، والـ effect بيرجع مبكراً بعدها (`RaceResults.jsx`).
4. **`Controls.jsx` \[○\]:** بيقول E وG = Drop Bomb، والاتنين بيستخدموا أي عنصر.
5. **`gameManager.startGame` \[◐ — الاتنين\]:** 4 `new Audio` كل مرة من غير إيقاف القديم، وأغنية 2.2 ميجا بـ `preload='auto'`، ومسارات `./music/` النسبية مختلطة مع `/music/` المطلقة. وفي كل الكود `new Audio()` جديد بدل pool.
6. **أرقام بره الـ config \[○\]:** `BLAST_RADIUS = 12`، و`BULLET_RIDE_MS` (مكرر مع `bullet.durationMs`)، و`PICKUP_RADIUS`، وبعض أرقام الـ turbo.
7. **الوقت \[◐ — الاتنين\]:** `delta` في `updateLapTime` متقصوص عند 0.1، فالتايمر بيقف لو التاب اتخبى أو حصل lag (أوقات أقل من الحقيقة، وده مؤثر أكتر أونلاين).
8. **`GloveHand`/`handAnchor` \[○\]:** الـ getter عام ومفرد (`setHandGetter`)، فلما أي `GloveHand` يتشال الـ cleanup بيمسحه للكل، والقذيفة بترجع لنقطة رمي قديمة. **و`HeldItems` \[○\]** بيحسب `performance.now()` وقت الـ render، فلما تصلّح مشكلة الـ re-render لازم تنقل الحساب ده لـ `useFrame` وإلا الـ ghost/pop هيتجمدوا.
9. **`KartDust.jsx:17` \[○\]:** `setIsOnDirt(wheel.shouldEmit)` جوه loop العجلات الأربع، فبتفضل قيمة آخر عجلة بس (استخدم `some()`).

## 5. الأداء

1. **Confetti دايم \[◐ — الاتنين\]:** `PlayerController.jsx:1022` فيه `VFXEmitter` بـ `loop:true` من غير `stopEmitting` والـ default `shouldEmitRef = true`، وده الـ emitter الوحيد في المشروع. تقريباً 2000 جسيم/ثانية طول السباق، وpool بـ 10,000 instance. (هل ظاهر طول السباق فعلاً؟ محتاج تجربتك.)
2. **`key={progress}` في `Kart.jsx:837` \[◐ — الاتنين\]:** الكارت كله بيتبني من جديد مع أي تحميل asset متأخر (وميض وتصفير particles).
3. **allocations كل فريم \[◐ — الاتنين، وأضاف التقرير المرفوع تفاصيل ○\]:** `PlayerController` (5 `new Vector3` + `resolveMeshWalls` 2 + `new Audio` في `reactToExplosions`)، و`Kart.getGroundPosition` (12 `Vector3` كل فريم)، و`Flames.jsx` (4 `Vector3` و2 `Quaternion` و`Euler` لكل instance، ومعاها `scale.lerp(scale, 0, …)` اتصال غلط) \[○\]، و`Trails.jsx` (`new THREE.Color` كل فريم وتوليد منحنى 300 نقطة) \[◐\]، و`ItemBoxes` (arrays جديدة كل فريم). ده بيخالف قاعدة AGENTS.md.
4. **4 كتابات في الـ store كل فريم من `Kart.jsx` \[◐\]:** `setWheelPositions` و`setFlamePositions` و`setDriftLevel` و`setBoostPower` بمصفوفات جديدة، و`setGamepad(gamepads[0])` كل فريم. أي component بيشترك فيهم هيعيد render 60 مرة في الثانية.
5. **مسح خطي لكل مثلثات الطريق \[◐ — الاتنين\]:** Mario Circuit فيها 15,380 مثلث طريق. `isOffRoad` كل 100ms، و`findNearestBlackRoadPoint3D` كل 15 فريم، و`getHighestRoadYAt` كل 20 فريم، كلهم بيلفوا على كل المثلثات وبيخلقوا objects (GC + تقطيع). الحل المقترح: spatial index.
6. **`TrackWalls` \[✔ + ◐\]:** معالجة O(حواف × مثلثات) وقت التحميل جوه الـ render، واتحسب **5 مرات** (كل Suspense retry بيرميه ويعيده).
7. **`MiniMap.jsx:279` \[◐\]:** `getBoundingClientRect()` كل فريم.
8. **Leva \[◐ + ○\]:** مستورد في الـ production (`App.jsx:10` و`ColorGradingEffect`) وفيه `<Leva` في `App.jsx:133`. ماتأكدتش لو بيتخفى.
9. **التحميل \[◐\]:** مسارات preload مختلفة (`./models/...` مقابل `/models/...`) بتكسر الـ cache فMario Circuit بتتحمل وتتفك مرتين. و`TrackSelect` و`LobbyScreen` بيحمّلوا الخرائط التلاتة (حوالي 12-14.6 ميجا) بمجرد فتح الشاشة.
10. **الحجم \[○\]:** الـ JS ملف واحد 2.05 ميجا (615 كيلو gzip)، و`bomb.glb` 2.9 ميجا و`item-box.glb` 2.2 ميجا والسائقين 3.1 و3.2 ميجا و`waluigi-stadiumMap.glb` حوالي 9.7 ميجا، والـ PWA بيعمل precache لـ 3.1 ميجا بس.

## 6. أخطاء الـ console

- **\[✔\]** `console.log(noiseTexture)` متروك في `particles/drift/glow/Glow.jsx:42` (طلع `[object _Texture]` 32 مرة في 20 ثانية).
- **\[✔\]** `Timer update...` كل ثانيتين (`App.jsx:59`)، و`LoadingScreen render` مع كل render (`LoadingScreen.jsx:16`).
- **\[✔\]** `GSAP target null not found` 6-8 مرات. التقرير المرفوع بيرجّعها لـ `Spark.jsx` (يستخدم `meshRef.current` في `onComplete` بعد الـ unmount) و`HomePage.jsx` (tween بـ `repeat:-1` ما بيتقتلش) \[○\].
- **\[✔\]** `The geometry has been cloned because it was already used` 15 مرة (المصدر `@three.ez/instanced-mesh`).
- **\[✔\]** `boostPower` بقى `NaN` لما مفيش drift: `Kart.jsx:823` بيعمل `driftLevel.threshold / 2` ومستوى none مفيهوش `threshold`. الكود شغال بالصدفة لأن NaN falsy.
- **\[✔\]** `net::ERR_FAILED` لموارد خارجية (CDN) في بيئة بلا إنترنت.

## 7. نظافة الكود والهيكل والقانوني

- **ESLint:** `GloveHand.jsx:92` (hook جوه callback/`useFrame` = `rules-of-hooks`)، و`main.jsx:96` و`Trails.jsx:25` ناقصهم dependencies، وحوالي 6 متغيرات غير مستخدمة (`itemAnim`، `materialRef`، `lapLabel`، `dash`، `delay`…).
- **`Lighting.jsx`:** الشرط `if (!playerPosition && !directionalLight.current) return` لازم يبقى `||`، وفيه imports غير مستخدمة (`Sky`، `Lightformer`، `Helper`، `CameraHelper`). وكمان imports ميتة في `App.jsx` (`Bvh`، `OrbitControls`، `Preload`).
- **`FinishLine.groundYAt`:** `catch {}` فاضي و`new Vector3` كل استدعاء.
- **كود ميت \[○\]:** `mapEditorStore.js` (مفيش editor في الريبو لكن `FinishLine` و`BoostPads` و`TrackWalls` لسه مشتركين فيه). و`HomePage` و`WebEvolution` كل واحد بيقتل **كل** الـ ScrollTriggers عند الـ unmount (بيقتل بتوع التاني).
- **الريبو \[○\]:** مفيش tests، و`bun.lockb` مع `package-lock.json`، و`.git` وزنه 41 ميجا، وملف تجريبي `mario-circuit-test-transformed.glb`، ومواصفتين لنفس الميزة في `docs/superpowers/specs/`. وأيقونة الـ PWA JPEG غير مربعة، ورقم الإصدار v0.4.0 في الواجهة مقابل 0.0.0 في `package.json`.
- **قانوني:** الريبو العام فيه أغنية `Mario Kart Wii OST.mp3` وموديلات ماريو ولويجي ومابات Nintendo (معرّض لـ DMCA). مش بق، بس خطر.

## 8. اتفحص واتضح إنه سليم، وتصحيحات

- كل مسارات الـ assets في الكود موجودة، مفيش 404 ثابت.
- Waluigi GLB فيه meshes مكررة، لكن `Track.jsx` بيدمجها بحسب الـ geometry فمفيش رسم مزدوج.
- ارتداد القذيفة (`bounceShell`) شغال (اختبرته بالدوال الحقيقية من 90° لـ 4°)، فرضيتي إنه بيستنزف الارتدادات كانت غلط.
- `mergeVertices(…, 0.25)` بـ pos+normal+uv أو position فقط: نفس عدد الحواف الحدودية بالظبط، فمفيش تأثير عملي.
- اتجاه سهم الـ MiniMap صحيح، ودوران الكارت مستقل عن الـ FPS بالتصميم، والكاميرا ما بتعملش overshoot، والـ tunneling غير محتمل بالسرعات العادية.
- **تصحيح (من التقرير المرفوع، ومتفق معاه):** حواجز Mario Circuit غالباً فيها تصادم عن طريق raycast على meshes اسمها ground. اللي مؤكد هو إن الـ road-edge walls عددها 0 وإن القذائف بتتجاهلها.
- **متصلّح في الريبو حسب التقرير المرفوع \[○\]:** `raceLive()` على `blooper:ink`، والتحقق من صاحب الضربة (`isAuthenticShellHit`)، والـ DEV hooks محمية بـ `import.meta.env.DEV`، والرصاصة ما بتشغّلش `isBoosting` وقت الركوب، و`windowUntil = null` للفطر الذهبي لحد أول استخدام.
- **خلاف بسيط:** التقرير المرفوع بيقول إن `TrackSelect`/`LobbyScreen` بيعملوا preload بدون مسار Draco فبيثبّتوا نسخة gstatic. أنا شايف إنهم بيشتغلوا بعد `setDecoderPath` فبيستخدموا `/draco/`، ونقل `setDecoderPath` لأول import كفاية (جرّبته).

## 9. اللي محتاج تجربتك (ما اتأكدش)

- Waluigi وShroom Ridge تشغيل كامل (سقوط، أسوار، تحميل، إحساس الفيزياء).
- الأونلاين بجهازين فعليين على شبكتين مختلفتين (TURN).
- هل الـ confetti ظاهر طول السباق ولا لحظة النهاية بس؟
- هل الكارت بيتحرك فعلاً أثناء العد التنازلي 3-2-1؟
- قياس الذاكرة للتحميل المزدوج، والـ FPS الحقيقي على جهازك.
- هل `getMeshColliders` ممكن يخزّن قايمة فاضية فعلاً؟ وهل Leva مخفي في الـ production؟

## 10. ترتيب الإصلاح المقترح

1. **TURN للأونلاين** (+ لوحة حالة اتصال في الـ lobby).
2. **ملف `draco-setup.js` أول import في `main.jsx`**، وHDR وخطوط محلية، و`ErrorBoundary` حوالين الـ Canvas، وإزالة الـ preload المكرر بالمسار النسبي.
3. **ترتيب النهاية** (`completedAt` للاعب المحلي أو ترتيب نهائي من الـ host)، وتوحيد معيار الترتيب بين الـ leaderboard والـ HUD، وتزامن بداية السباق (مش بساعة الأجهزة).
4. **checkpoints/sectors لعد اللفات** وتحقق الـ host من معقولية `race:progress`، والرجوع التلقائي لكل الخرائط.
5. **تأمين أحداث الأونلاين:** `bomb:explode` و`blue:explode` و`item:boxes` و`item:boxTaken` (المرسل = صاحب الحدث/الـ host)، وقيود على `dx`/`dz`/`top`، وrate limiting.
6. **زر استخدام العناصر للموبايل وربط للذراع**، وPause حقيقي، وحماية الـ gamepad (`?.` + deadzone)، وتغيير شرط اللمس بحيث ما يعتمدش على `maxTouchPoints` لوحده.
7. **Reset كامل للكارت** عند «Race Again»، وبوابة `gameStarted` في الـ `PlayerController`، وتحميل الماب قبل العد التنازلي.
8. **Shroom Ridge:** صلّح `RemoteRacers.jsx:99-101` (شيل القسمة على `rs` من الـ position)، واضرب سرعات وأقطار العناصر والعتبات (زحف الـ Lakitu) في `kartScale`، وثبّت ارتفاع خط النهاية (Waluigi وShroom) بالـ road mesh بدل أول ground.
9. **تقليل الـ re-renders:** selectors لـ `useGameManager`، وشيل الـ logs، وشيل `key={progress}`، ووقّف الـ confetti، وانقل حسابات `HeldItems` لـ `useFrame` الأول.
10. **ربط الفيزياء بالـ `delta`:** الاحتكاك بالحيط ولفة العجلات و`maxClimb`/`maxDrop`، وتوحيد عتبات الأرضية/الحائط، وspatial index لـ `trackRoad`، وتصحيح قرارات `TrackWalls` (حد الـ downsampling ما يقصّش حيطان بصمت).
11. **الأصوات:** كلها تحترم `sfxVolume` وتتجمّع في pool.
12. **ضغط الموديلات وتقسيم الـ bundle**، ومعالجة الأصول المحمية بحقوق.
