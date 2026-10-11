# تقرير فحص كامل: Mario-Kart (Basem321)

الريبو: `github.com/Basem321/Mario-Kart` فرع `main`. الكود في `src/` حوالي **15,275 سطر** (من غير مكتبة الـ joystick).

## 0. الصدق في التغطية (قبل أي حاجة)

**ما قريتش كل سطر حرفياً.** بعد الجولة الأخيرة قريت **حوالي 92%** من منطق الكود. الباقي مكتبات منقولة وCSS وجداول وـshaders (التفاصيل تحت).

| الحالة | الملفات |
|---|---|
| **قريتها كلها أو تقريباً** | `PlayerController`, `ItemBoxes` (النسخة الحالية كلها), `collision`, `trackRoad`, `tracks`, `constants`, `Track`, `TrackWalls` (جزء كبير), `FinishLine`, `gameManager`, `GameReadyCheck`, `WebGPUCanvas`, `BVHEnsure`, `TrackScene`, `main`, `App`, `Controls`, `BoostPads`, `LoadingScreen`, `PwaUpdateToast`, `GameUI` (المنطق), `RaceResults`, `OnlineRaceLeaderboard`, `MiniMap`, `LobbyScreen`, `TrackSelect`, `CharacterSelect`, `HomePage` (المنطق), `mobile/*`, `hooks/*`, `misc/*`, `onlineRaceTransport`, `particles/*` (Dust, Spark, Glow, Skate, Flames, Skid, Trails) |
| **قريتها جزئياً** | `useP2PLobby` (حوالي 85%: الـ validators والـ host والـ guest والـ cleanup)، `Kart.jsx` (الفيزياء والـ frame loop والـ render كلهم، ما قريتش آخر 150 سطر JSX للعجلات)، `ColorGradingEffect` (الـ JS بس)، `animCurves.js` (الدوال وساعتها بس، مش كل منحنى حركة) |
| **قريتها من نسخ أقدم ثم راجعت الحالية بـ diff/grep** | `Pickups`, `homing`, `itemWeights`, `itemConfig`, `itemVisuals`, `store`, `onlineRaceStore`, `RemoteRacers`, `Driver` |
| **قريتها في الجولة الأخيرة (الـ 20%)** | `HeldItems`, `GloveHand`, `handAnchor`, `itemScale`, `Kart.jsx` الحالي، `useP2PLobby` الـ validators، `wawa-vfx` (فحص عميق بالبحث)، `WebEvolution`, `mapEditorStore` |
| **ما قريتهاش سطر بسطر** | مكتبة `mobile/react-joystick-component` (منقولة)، ملفات CSS، `wawa-vfx/easings.ts` و`types.ts` (جداول)، نص الـ GLSL في `ColorGradingEffect`، شكل الـ JSX في `HomePage` و`WebEvolution` (قريت المنطق بس) |

وشغّلت فعلاً: `npm ci`، `eslint`، `vite build`، وشغّلت اللعبة في Chromium headless على **Mario Circuit بس** وقدت العربية. Waluigi Stadium وShroom Ridge اتحمّلوا بطيء جداً في بيئتي (SwiftShader) فما قدرتش أجمع عينات منهم.

العلامات: **[شغّلتها]** شفتها وقت التشغيل. **[قرأتها]** من الكود. **[تأكد]** مشتبه فيها ومحتاجة تجربة منك.

> **تصحيح لتقريري اللي فات:** قلت إن حواجز Mario Circuit غالباً مفيهاش تصادم. ده ما اتأكدش. العربية بتتصادم مع أي mesh اسمه "ground" عن طريق raycast (وكل الـ 10 meshes في Mario Circuit اسمهم كده)، فالتصادم غالباً شغال. اللي مؤكد إن **القواقع** لا تتصادم معاها (شوف 2.4). وكمان E و G الاتنين بيستخدموا العنصر، فكلام الـ Controls عنهم تفصيلة بسيطة بس، مش خطأ كبير.

---

## 1. أخطاء حرجة

### 1.1 الأونلاين من غير TURN [قرأتها]
`useP2PLobby.js:630` و`:823`: `new Peer()` من غير `iceServers`. بين شبكتين مختلفتين الاتصال بيفشل. ده على الأرجح سبب مشكلتك.
**الحل:** مرّر `config.iceServers` فيها TURN مجاني (مثل Open Relay)، وضيف لوحة حالة اتصال في الـ lobby.

### 1.2 اللعبة بتتوقف لو CDN اتحجب [شغّلتها]
- `EnvironmentSphere.jsx`: `<Environment preset="warehouse">` بيحمّل HDR من CDN خارجي. لما فشل: `An error occurred in the <CanvasImpl> component`، والـ Canvas كله وقع. مفيش ErrorBoundary.
- **Draco decoder:** `main.jsx` بيعمل `useGLTF.setDecoderPath('/draco/')` بعد ما `Kart` و`Driver` و`Pickups` عملوا `useGLTF.preload`، فـ preloads دي بتستخدم `gstatic.com`. شفت الـ requests بتفشل.
- **أسوأ:** `TrackSelect` و`LobbyScreen` بيعملوا `useGLTF.preload(track.glb)` بدون مسار Draco. لو اتنفذت أول، الـ cache بيحتفظ بالنسخة اللي اتحملت بـ gstatic، فـ `useGLTF(track.glb, '/draco/')` في `Track.jsx` بيتجاهل المسار المحلي.
- Google Fonts (`@import`) في `index.css` و`HomePage.css`.
**الحل:** ملف `draco-setup.js` يتستورد أول حاجة في `main.jsx`، وHDR وfonts محلية، وErrorBoundary.

### 1.3 اللفات من غير checkpoints [قرأتها]
`FinishLine.jsx`: اللفة بتتحسب لو عدّيت الخط للأمام، وابعدت 28 وحدة، ومرّ 3 ثواني. ترجع لورا 28 متر وتعدّي تاني وتاخد لفة. في الأونلاين `completedLaps` بيتبعت من الـ client من غير تحقق. وبيانات `checkpoints` موجودة في إعدادات الـ tracks لكن ما بتتستخدمش في عد اللفات.

### 1.4 اللاعب المحلي دايماً بيخسر التعادل في الترتيب [قرأتها]
`RaceResults.jsx:58` و`OnlineRaceLeaderboard.jsx:49`: `completedAt` بيتحسب من `progress.completedAt`، لكن صف اللاعب نفسه (`isSelf`) مفيهوش `completedAt` أصلاً، فبيبقى `Infinity`. لو خلصت السباق وصاحبك خلص بنفس عدد اللفات، **ترتيبك دايماً بعده** حتى لو خلصت قبله بثانيتين. (`completedAt` للباقيين بيتختم من ساعة الـ host.)
**الحل:** الـ host يبعت الترتيب النهائي، أو خزّن وقت نهايتك بنفس الساعة.

### 1.5 العناصر ما تتستخدمش على الموبايل ولا على الذراع [قرأتها]
`ItemBoxes.jsx:1247`: الاستخدام من `keys.dropBomb || keys.useItem` يعني لوحة المفاتيح بس. على الموبايل في زرار واحد (`A` للدرفت) ومفيش زرار للعنصر، وعلى الذراع مفيش ربط. يعني **كل ميزة العناصر معطّلة على اللمس والذراع**.

### 1.6 الـ Pause مش بيوقف اللعبة [قرأتها]
`GameUI.jsx`: Escape بيفتح قايمة بس (`isPauseMenuOpen`)، ومفيش `isPaused` في `gameManager`. العربية والوقت والـ Time Trial بيكملوا والمفاتيح شغالة والقايمة مفتوحة.

### 1.7 الـ Canvas كله بيعيد render كل frame [قرأتها + شفت النتيجة]
`gameManager.updateLapTime` بيعمل `set` كل frame (totalTime وcurrentLapTime). و`main.jsx` (Root) و`LoadingScreen` و`GameUI` و`GameReadyCheck` بيستخدموا `useGameManager()` بدون selector، فبيعيدوا render كل frame. شفت `LoadingScreen render - ...` 24 مرة أثناء التحميل بس، لأن فيه `console.log` جوه الـ render. ده ضغط CPU كبير ورسائل console مستمرة.

### 1.8 كراش محتمل مع بعض أذرع التحكم [قرأتها]
`PlayerController`: `gamepadRef.current.buttons[5].pressed || buttons[7].pressed`. لو الذراع أقل من 8 buttons: `TypeError` في كل frame والعربية تتجمد. استخدم `buttons[5]?.pressed`.

### 1.9 بداية السباق الأونلاين تعتمد على ساعة الأجهزة [قرأتها]
`useP2PLobby.startRace`: `startsAt: Date.now() + 900` من ساعة الـ host، والـ guest بيحسب `startsAt - Date.now()` بساعته. لو الساعات مختلفة بثانية أو أكتر، السباق يبدأ في أوقات مختلفة (أو فوراً).

---

## 2. أخطاء متوسطة

### 2.1 الفيزياء والماب
1. **تباطؤ الاحتكاك بالحيط بيعتمد على FPS** (`collision.js`): `speed *= wallSpeedFactor` كل frame (0.82 لو بتحك، 0.45 لو بتخبط). على 144Hz العربية بتقف أسرع بحوالي 2.4 مرة من 60Hz.
2. **لفة العجلة بتعتمد على FPS** (`Kart.jsx:218-222`): `rotation.x += speed * 0.01` من غير `delta`.
3. **الرجوع التلقائي لو خرجت من الماب:** النزول في الفراغ بيتعالج في كل الـ tracks (`Kart.jsx`: لو العجلات في الهوا أكتر من `MAX_AIR_TIME + 0.6` ثانية أو `y < -25` بيعمل `mario-kart:reset`). لكن الضياع **على الأرض بعيد عن الطريق** (`PlayerController.detectLostOffMap`) بيرجع فوراً لو مفيش `checkpoints`، وهم معرّفين في `tracks.js:235` لـ Shroom Ridge بس. Mario Circuit وWaluigi: مفيش reset تلقائي للحالة دي (R بس).
4. **زرار R (reset) بيتيلّب لأقرب checkpoint** (في Shroom Ridge)، يعني ممكن يتستغل كاختصار مع غياب checkpoints اللفات.
5. **`isOffRoad` بيتجاهل الارتفاع** (`trackRoad.js`): العربية اللي تحت كوبري/جسر بتعتبر "على الطريق".
6. **مسح كل مثلثات الطريق بشكل خطي** (`findNearestBlackRoadPoint`): Mario Circuit فيها **15,380 مثلث** طريق (`Object_24`). الدالة بتعمل 3 `closestPointOnSegment` لكل مثلث وبتخلق objects، كل 100ms لو العربية برا الطريق، و`detectLostOffMap` و`detectTrappedUnderDeck` بيعملوا نفس المسح كل 15 و20 frame. ده مولّد GC وتقطيع.
7. **`TrackWalls`:** بيلف على كل مثلثات الطريق لكل حافة (مرتين) على الـ main thread وقت التحميل.
8. **`PlayerController.getMeshColliders`** بيجمع meshes "ground" مرة واحدة ويخزنها حتى لو القايمة فاضية، فلو اتنادت قبل تحميل الـ track التصادمات دي ما تشتغلش طول السباق. [تأكد]
9. **Mario Circuit مشهد 460 ألف مثلث**، وWaluigi 253 ألف، وShroom Ridge 305 ألف، وكلهم بـ `side = DoubleSide` من `Track.jsx`. ثقيل جداً على الموبايل.
10. **الـ Confetti:** `VFXEmitter` بـ1000 جسيم وهو `loop: true` على العربية طول السباق، مع `VFXParticles` بـ10,000 مثيل في `App.jsx`. [قرأتها + شفت النقط الملونة في لقطتك]
11. **`BoostPads`:** مجسم الـ pad بيدور بـ`rotation` لكن اختبار الاصطدام بيتجاهله، فالـ pads المدورة بتشتغل في مستطيل مختلف عن اللي بتشوفه. [قرأتها]
12. **`Lighting.jsx`:** الشرط `if (!playerPosition && !directionalLight.current) return` لازم يبقى `||`. لو `playerPosition` موجود والـ light ref لسه null: `TypeError`.

### 2.2 العناصر والأونلاين
1. **القواقع الحمراء بتعدّي من حواجز Mario Circuit:** `wallHitNormal` بيستخدم `wallSegments` وهي 4 بس في Mario Circuit [شغّلتها]، فمنطق الارتداد (bounces) عملياً ميت هناك. العربية بتتصادم مع الـ mesh، لكن القذيفة لا.
2. **القوقعة الزرقاء لو الرامي هو الأول:** بتختار أول منافس مش خالص، مش الأقرب أو الأقوى ترتيباً (`ItemBoxes.fireBlueShell`).
3. **القنبلة:** `bombAgeMs` بيستخدم `Date.now() - createdAt` (ساعة المرسل)، فعلى جهاز ساعته متقدمة ثانية القنبلة بتتسلح فوراً. وصوت الانفجار بـ`volume = 1` بيتجاهل `sfxVolume`، وكذلك `blueAlarm` (0.6) و`spin.mp3` (0.9).
4. **`useGLTF.preload("./models/mario-circuit-test-transformed.glb")`** في `ItemBoxes.jsx` و`BVHEnsure.jsx` (مسار نسبي `./` وبدون Draco). الـ cache بيعتبره مفتاح مختلف عن `/models/...`، فـ Mario Circuit بيتحمّل ويتفكّ **مرتين** (2 نسخة من 460 ألف مثلث في الذاكرة). [قرأتها، ما قسّتش الذاكرة]
5. **`TrackSelect` و`LobbyScreen`:** بيعملوا preload لكل الـ tracks (Waluigi 9.7 ميجا وShroom 2.7 ميجا) بمجرد فتح الشاشة، حتى لو هتختار Mario Circuit. على داتا الموبايل ده تحميل 12 ميجا غير مطلوب.
6. **أيقونة الفطر الذهبي = أيقونة الفطر العادي** في الـ HUD (`GameUI.jsx`)، وأيقونتي skid وwind كمان نفس الفطر.
7. **`Controls.jsx`:** بيقول E وG "Drop Bomb". الاتنين بيستخدموا أي عنصر.
8. **الـ lobby:** مفيش حد أقصى للاعبين (`upsertPlayer`) ولا throttle على الرسائل، و`lobby:join` بيتقبل أثناء السباق، والـ host لو خرج الغرفة بتنتهي. `RACER_COLORS` في الـ minimap 6 ألوان بس (بيتكرروا بعد 6 لاعبين)، وعدد `spawnSlots` 10.
9. **`gameManager.startGame`:** 4 `new Audio` كل مرة من غير إيقاف القديم، وأغنية 2.2 ميجا بـ`preload='auto'`، ومسارات `./music/` النسبية في أماكن و`/music/` المطلقة في أماكن تانية.
10. **الوقت:** الـ delta في `updateLapTime` بيتقص عند 0.1 ثانية، فعلى الأجهزة البطيئة (أقل من 10 FPS) ساعة السباق أبطأ من الوقت الحقيقي (أوقات أقل من الحقيقة).
11. **`Date.now` في 16 مكان** مع `performance.now`: دوران قواقع الـ triple وحالة الـ anim بيعتمدوا على ساعة كل جهاز.
12. **أرقام بره الـ config:** `BLAST_RADIUS = 12`، و`BULLET_RIDE_MS` (مكررة مع `bullet.durationMs`)، و`PICKUP_RADIUS`، وبعض أرقام الـ turbo.

### 2.3 الأداء (allocations كل frame، بتخالف قاعدة AGENTS.md)
- `PlayerController.updatePlayer`: 5 `new Vector3` كل frame و`resolveMeshWalls` 2، وبيعمل `new Audio` جوه `reactToExplosions`.
- `Kart.getGroundPosition`: 3 `new Vector3` لكل عجلة (12 كل frame)، و`direction`/`upDirection` بتتخلق كل render.
- `Flames.jsx`: لكل instance كل frame: 4 `Vector3` و2 `Quaternion` و`Euler` و`getWorldPosition(new Vector3())`. وكمان `obj.scale.lerp(obj.scale, 0, delta*30)` استدعاء غلط (alpha=0 فما بيعملش حاجة).
- `Trails.jsx`: `new THREE.Color` كل frame لكل trail وإعادة توليد منحنى 300 نقطة على الـ main thread.
- `ItemBoxes`: `victims`/`rows` arrays و`[...st.droppedBombs]` وغيرها كل frame.
- **Leva** (واجهة debug) مستورد في الـ production (`App.jsx` و`ColorGradingEffect`) بيسجل عشرات الـ sliders.
- `setGamepad(gamepads[0])` كل frame بـ snapshot جديد، و`MobileControls` مشترك فيه.

### 2.4 تحذيرات الـ console [شغّلتها]
- `GSAP target null not found` 6-8 مرات: `Spark.jsx` (يستخدم `meshRef.current` داخل `onComplete` بعد الـ unmount) و`HomePage.jsx` (tween `repeat: -1` على `.play-button` وغيره ما بيتقتلش، والـ cleanup بيقتل الـ ScrollTriggers بس).
- `The geometry has been cloned because it was already used`.
- `console.log(noiseTexture)` في `Glow.jsx` (بيطبع `_Texture` 4 مرات)، و`console.log` في `App.jsx` كل ثانيتين، و`FinishLine` و`gameManager`.
- `net::ERR_FAILED` مرتين لمورد خارجي.

### 2.5 نظافة الكود
- ESLint: `GloveHand.jsx:92` (`useItemScale` اسمها hook وجوه `useFrame`)، وـ`main.jsx:96` وـ`Trails.jsx:25` ناقصهم dependencies، و6 متغيرات مش مستخدمة (`itemAnim`، `materialRef`، `lapLabel`، `dash`، `delay`…).
- `Lighting.jsx` بيستورد `Sky` و`Lightformer` و`Helper` و`CameraHelper` ومش بيستخدمهم.
- `KartDust.jsx:17`: `setIsOnDirt(wheel.shouldEmit)` جوه loop على العجلات الأربع، فبتفضل قيمة آخر عجلة بس. استخدم `some()`.
- `Kart.jsx:837`: `key={progress}` بيعيد بناء العربية عند أي تغير في progress التحميل. و`Kart.jsx:273` و`:727`: لو مفيش 2 meshes أرضية على الأقل، بيعمل `scene.traverse` وraycast على `scene.children` كل frame.
- `FinishLine.groundYAt`: `catch {}` فاضي و`new Vector3` كل استدعاء.

### 2.6 اكتشافات من الـ 20% الأخيرة
1. **الـ spin بيجمّد بيانات العجلات** (`Kart.jsx`): وقت الـ spin الكود بيتخطى `getGroundPosition` و`setWheelPositions` و`moveAndRotateKart`، فـ `groundPosition` (اللي بتستخدمه القوقعة الزرقاء وتصادم الأسوار) والتراب وعلامات الدرفت بتفضل على آخر قيمة لحد ما الـ spin يخلص.
2. **`key={progress}` بيعيد بناء العربية أثناء السباق** لو أي asset اتحمّل متأخر (`useProgress` عام)، فيحصل وميض وتصفير للـ particles. [قرأتها]
3. **4 كتابات في الـ store كل frame من `Kart.jsx`** (`setWheelPositions` و`setFlamePositions` و`setDriftLevel` و`setBoostPower`) كل واحدة بمصفوفات جديدة، مع `new Vector3` للـ flames. أي component بيشترك فيهم عن طريق hook هيعيد render 60 مرة في الثانية. [تأكد إن حد بيشترك]
4. **`GloveHand` و`handAnchor`:** الـ getter عام ومفرد (`setHandGetter`)، فلما يتشال أي `GloveHand` (مثلاً قنبلة + عنصر ممسوكين) الـ cleanup بيمسح الـ getter للكل، فالقذيفة بترجع لنقطة الرمي القديمة. وكمان `useItemScale` اسمها hook وبتتنادى جوه `useFrame`.
5. **`HeldItems` بيحسب `performance.now()` وقت الـ render** (حالة الـ ghost والـ pop)، يعني بيعتمد على عاصفة الـ re-render في 1.7. **لما تصلّح 1.7 لازم تنقل الحسابات دي لـ `useFrame`** وإلا الـ ghost/pop هيتجمدوا.
6. **الـ validators في `useP2PLobby` مش بتتحقق من معقولية `race:progress`:** بتتأكد إن الأرقام متسقة بس (`completedLaps` و`currentLap` و`finished`)، فأي لاعب يقدر يبعت إنه خلص كل اللفات فوراً. ومفيش حد لعدد `shell:fired` و`bomb:dropped` من نفس اللاعب، فالمصفوفات `activeShells` و`droppedBombs` ممكن تتضخم لحد ما اللعبة تتجمد.
7. **`shell:fired`:** حقل `ownerId` بيتاخد من الـ payload من غير ما يتقارن بهوية المرسل الموثقة، فممكن تنسب قذيفة للاعب تاني (شكلي بس، لأن التحقق من `shell:hit` بيمنع تزوير الإصابة).
8. **`mapEditorStore.js` ميت:** مفيش واجهة editor في الريبو ولا أي استدعاء لـ `openEditor`، لكن `FinishLine` و`BoostPads` و`TrackWalls` لسه مشتركين فيه.
9. **`HomePage` و`WebEvolution` كل واحد بيقتل كل الـ ScrollTriggers (`getAll().forEach(kill)`)** عند الـ unmount، فبيقتل بتوع التاني كمان.
10. **`wawa-vfx`:** اتصلح فيه تسريب GPU (`geo.dispose()`)، ومفيش مشاكل واضحة غير `console.log` في `VFXBuilder` (أداة dev).

---

## 3. الحجم والأداء العام [شغّلتها]
- الـ JS ملف واحد **2.05 ميجا** (615 كيلو gzip).
- موديلات ثقيلة لحاجات صغيرة: `bomb.glb` 2.9 ميجا، `item-box.glb` 2.2 ميجا، السائقين 3.1 و3.2 ميجا، `waluigi-stadiumMap.glb` 9.7 ميجا.
- الـ PWA بيعمل precache لـ 3.1 ميجا بس، والباقي (حوالي 28 ميجا) من الشبكة.

## 4. قانوني وهيكلي
- أغنية `Mario Kart Wii OST.mp3` وموديلات ماريو ولويجي في ريبو عام (معرّض لـ DMCA). ما أعرفش مصدر الأصول.
- مفيش tests في الريبو (انت مسحتها).
- lockfile مكرر (`bun.lockb` و`package-lock.json`)، و`.git` وزنه 41 ميجا، وملف تجريبي `mario-circuit-test-transformed.glb`، ومواصفتين لنفس الميزة في `docs/superpowers/specs/`.

## 5. اللي اتصلح من مراجعات سابقة (مؤكد في الريبو)
- `raceLive()` على `blooper:ink`.
- التحقق من صاحب الضربة (`isAuthenticShellHit`).
- الـ DEV hooks محمية بـ `import.meta.env.DEV`.
- الرصاصة ما بتشغّلش `isBoosting` وقت الركوب.
- `windowUntil = null` للفطر الذهبي لحد أول استخدام (شوف `ItemBoxes.jsx`).

## 6. اللي ما اتأكدتش منه (محتاج تجربتك)
- Waluigi وShroom Ridge وقت التشغيل (سقوط، أسوار، تحميل).
- الأونلاين بجهازين فعليين على شبكتين.
- هل الـ confetti ظاهر طول السباق ولا لحظة النهاية بس؟
- قياس الذاكرة الفعلي للتحميل المزدوج.
- الأداء الحقيقي (FPS) على جهازك، لأن بيئتي بدون GPU.

## 7. ترتيب الإصلاح المقترح
1. TURN للأونلاين (1.1) + لوحة الحالة.
2. نقل `setDecoderPath` وHDR وfonts محلية وErrorBoundary (1.2) وشيل الـ preload المكرر والمسار النسبي (2.2.4 و2.2.5).
3. ترتيب النهاية (1.4) وبداية السباق (1.9).
4. checkpoints للفات (1.3) والرجوع التلقائي لكل الـ tracks (2.1.3).
5. زرار العنصر للموبايل والذراع (1.5)، وPause حقيقي (1.6)، وحماية الـ gamepad (1.8).
6. تقليل الـ re-renders: selectors لـ `useGameManager` وشيل الـ logs (1.7). **ملحوظة:** انقل حسابات `HeldItems` للـ `useFrame` الأول (2.6.5).
7. تصادم القواقع مع الحواجز (2.2.1)، وتسريع `trackRoad` بـ spatial index (2.1.6)، وربط الاحتكاك وعجلات الكارت بـ `delta` (2.1.1 و2.1.2).
8. ضغط الموديلات وتقسيم الـ bundle (3).
9. الأصول المحمية بحقوق (4).
