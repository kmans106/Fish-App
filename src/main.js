import * as THREE from 'three/webgpu';
import { output } from 'three/tsl';
import { createBoids } from './boids.js';
import { createFormationDirector, createCameraDirector } from './choreography.js';
import { createFish, fishBrightness, goldAmount } from './fish.js';
import { createEvents } from './events.js';
import { createPanel, DEFAULTS } from './panel.js';
import { createEnvironment, createEnvironmentScene, underwaterFog } from './environment.js';
import { createPipeline } from './post.js';
import { SUN_DIR, SURFACE_Y, cloudTime, cloudShadeJS, waterDensity } from './ocean.js';
import { createPredator } from './predator.js';
import { createControls } from './controls.js';
import { createHunt } from './game.js';
import { audio } from './audio.js';
import { loadNumber, saveNumber } from './native.js';

const $ = ( id ) => document.getElementById( id );
const msg = $( 'msg' );

const params = new URLSearchParams( location.search );
const isMobile = matchMedia( '(pointer: coarse)' ).matches;
const FISH_COUNT = Math.min( 32768, Math.max( 256, parseInt( params.get( 'n' ) ) || ( isMobile ? 3072 : 6144 ) ) );
const BEST_KEY = 'deepSchool.bestScore';

async function main() {

	if ( ! navigator.gpu ) {

		msg.innerHTML = 'This device does not support WebGPU<br><span style="opacity:.6;font-size:13px">Deep School needs iOS 26 or later (or a recent Chrome / Edge / Safari on desktop)'
			+ ( window.isSecureContext ? '' : '<br>(page is not a secure context — WebGPU requires https or localhost)' ) + '</span>';
		return;

	}

	const renderer = new THREE.WebGPURenderer( { antialias: true } );
	renderer.setPixelRatio( Math.min( window.devicePixelRatio, isMobile ? 1.25 : 1.5 ) );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.0;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;
	document.body.appendChild( renderer.domElement );
	await renderer.init();

	if ( renderer.backend.isWebGPUBackend !== true ) {

		msg.innerHTML = 'Could not start the WebGPU device<br><span style="opacity:.6;font-size:13px">Make sure hardware acceleration is enabled</span>';
		return;

	}

	const scene = new THREE.Scene();
	scene.fogNode = underwaterFog( output );

	const camera = new THREE.PerspectiveCamera( 62, window.innerWidth / window.innerHeight, 0.1, 2000 );
	camera.position.set( 0, 0, 40 );

	// 环境反射（给银色鱼鳞提供明亮的顶光反射）
	const pmrem = new THREE.PMREMGenerator( renderer );
	scene.environment = pmrem.fromScene( createEnvironmentScene(), 0.04 ).texture;
	scene.environmentIntensity = 1.25;

	// 太阳光（已考虑折射后的角度），投射鱼群阴影
	const sun = new THREE.DirectionalLight( 0xeafcff, 5.0 );
	sun.castShadow = true;
	sun.shadow.mapSize.set( 2048, 2048 );
	const sc = sun.shadow.camera;
	sc.left = - 60; sc.right = 60; sc.top = 60; sc.bottom = - 60; sc.near = 1; sc.far = 160;
	sun.shadow.bias = - 0.0004;
	sun.shadow.normalBias = 0.03;
	sun.shadow.radius = 3;
	// 阴影强度减半：鱼群保留内外明暗层次，但不会整团发暗
	sun.shadow.intensity = 0.35;
	scene.add( sun, sun.target );

	// 水下四周的散射光：给鱼身一个稳定的漫反射底亮度，近看不会只靠镜面反射而发黑
	const ambient = new THREE.HemisphereLight( 0x9fdcea, 0x0b2c36, 0.35 );
	scene.add( ambient );

	const env = createEnvironment();
	scene.add( env.group );

	const boids = createBoids( FISH_COUNT );
	const fish = createFish( boids, FISH_COUNT );
	scene.add( fish );

	const predator = createPredator();
	scene.add( predator.object );

	const post = createPipeline( renderer, scene, camera, sun );

	const u = boids.uniforms;

	// ---------- game state ----------
	// menu → hunt ⇄ paused → over → (hunt | menu);  menu ⇄ zen
	let mode = 'menu';
	let best = await loadNumber( BEST_KEY, 0 );

	const screens = { menu: $( 'menu' ), paused: $( 'paused' ), over: $( 'over' ) };
	const hudEl = $( 'hud' );

	const hud = createHud();
	const controls = createControls( renderer.domElement, $( 'stick' ), $( 'knob' ), $( 'dash' ) );
	const hunt = createHunt( { renderer, boids, camera, predator, controls, hud } );

	function show( name ) {

		for ( const k in screens ) {

			if ( k === name ) {

				screens[ k ].classList.remove( 'hidden' );
				requestAnimationFrame( () => screens[ k ].classList.remove( 'fade' ) );

			} else {

				screens[ k ].classList.add( 'hidden', 'fade' );

			}

		}

	}

	function setMode( m ) {

		mode = m;
		hudEl.classList.toggle( 'hidden', m !== 'hunt' );
		$( 'zenBar' ).classList.toggle( 'hidden', m !== 'zen' );
		$( 'zenHint' ).classList.toggle( 'hidden', m !== 'zen' );
		$( 'mute' ).classList.toggle( 'hidden', m === 'hunt' || m === 'zen' );
		show( m === 'menu' || m === 'paused' || m === 'over' ? m : null );
		if ( m !== 'zen' ) pointerActive = 0;
		applyEventSettings();

	}

	function updateBestLabel() {

		$( 'menuBest' ).textContent = best > 0 ? `BEST  ${best}` : '';

	}

	function startHunt() {

		audio.unlock();
		events.cancel();
		hud.hintVisible( true );
		hunt.start( u.target.value, endHunt );
		setMode( 'hunt' );

	}

	function endHunt( result ) {

		const isBest = result.score > best;
		if ( isBest ) {

			best = result.score;
			saveNumber( BEST_KEY, best );

		}

		$( 'finalScore' ).textContent = result.score;
		$( 'newBest' ).classList.toggle( 'hidden', ! isBest );
		$( 'finalStats' ).innerHTML =
			`<b>${result.caught}</b> fish eaten · <b>${result.goldCaught}</b> golden<br>best streak <b>${result.bestCombo}</b> · best score <b>${best}</b>`;
		updateBestLabel();
		setMode( 'over' );

	}

	function pause() {

		if ( mode !== 'hunt' ) return;
		controls.reset();
		setMode( 'paused' );

	}

	$( 'playBtn' ).addEventListener( 'click', startHunt );
	$( 'againBtn' ).addEventListener( 'click', startHunt );
	$( 'zenBtn' ).addEventListener( 'click', () => {

		audio.unlock();
		setMode( 'zen' );

	} );
	$( 'zenExit' ).addEventListener( 'click', () => setMode( 'menu' ) );
	$( 'menuBtn' ).addEventListener( 'click', () => setMode( 'menu' ) );
	$( 'pause' ).addEventListener( 'pointerdown', ( e ) => e.stopPropagation() );
	$( 'pause' ).addEventListener( 'click', pause );
	$( 'resumeBtn' ).addEventListener( 'click', () => {

		audio.resume();
		setMode( 'hunt' );

	} );
	$( 'quitBtn' ).addEventListener( 'click', () => {

		hunt.stop();
		setMode( 'menu' );

	} );
	$( 'mute' ).addEventListener( 'click', () => {

		audio.unlock();
		audio.muted = ! audio.muted;
		$( 'mute' ).style.opacity = audio.muted ? 0.4 : 1;

	} );
	window.addEventListener( 'keydown', ( e ) => {

		if ( e.code === 'Escape' || e.code === 'KeyP' ) {

			if ( mode === 'hunt' ) pause();
			else if ( mode === 'paused' ) setMode( 'hunt' );

		}

	} );

	// app sent to background (home button, phone call…): pause the round and the sound
	document.addEventListener( 'visibilitychange', () => {

		if ( document.hidden ) {

			pause();
			audio.suspend();

		} else if ( mode !== 'paused' ) {

			audio.resume();

		}

	} );

	// ---------- Zen mode interaction (the original experience) ----------
	const ndc = new THREE.Vector2( 10, 10 );
	const raycaster = new THREE.Raycaster();
	let pointerActive = 0;
	const touches = new Map();
	let pinchDist = 0;

	const setPointer = ( e ) => {

		ndc.set( ( e.clientX / window.innerWidth ) * 2 - 1, - ( e.clientY / window.innerHeight ) * 2 + 1 );

	};

	const pinchDistance = () => {

		const [ a, b ] = [ ...touches.values() ];
		return Math.hypot( a.x - b.x, a.y - b.y );

	};

	renderer.domElement.addEventListener( 'pointermove', ( e ) => {

		if ( mode !== 'zen' ) return;
		if ( touches.has( e.pointerId ) ) touches.set( e.pointerId, { x: e.clientX, y: e.clientY } );

		if ( touches.size === 2 ) {

			const d = pinchDistance();
			if ( pinchDist > 0 ) zoom = THREE.MathUtils.clamp( zoom * pinchDist / d, 0.45, 1.6 );
			pinchDist = d;
			return;

		}

		const isTouch = e.pointerType !== 'mouse';
		setPointer( e );
		if ( ! isTouch || e.buttons ) pointerActive = 1;

	} );

	renderer.domElement.addEventListener( 'pointerdown', ( e ) => {

		if ( mode !== 'zen' ) return;
		touches.set( e.pointerId, { x: e.clientX, y: e.clientY } );
		if ( touches.size === 2 ) {

			pinchDist = pinchDistance();
			pointerActive = 0;
			return;

		}

		setPointer( e );
		pointerActive = 1;
		raycaster.setFromCamera( ndc, camera );
		// 冲击点取射线上离鱼群中心最近的位置
		const ray = raycaster.ray;
		const t = Math.max( 4, ray.direction.dot( u.target.value.clone().sub( ray.origin ) ) );
		u.burstPoint.value.copy( ray.origin ).addScaledVector( ray.direction, t );
		u.burst.value = 1;

	} );

	const release = ( e ) => {

		touches.delete( e.pointerId );
		if ( touches.size < 2 ) pinchDist = 0;
		if ( e.type === 'pointerleave' || e.pointerType !== 'mouse' ) pointerActive = 0;

	};

	renderer.domElement.addEventListener( 'pointerup', release );
	renderer.domElement.addEventListener( 'pointercancel', release );
	renderer.domElement.addEventListener( 'pointerleave', release );

	let zoom = 1;
	window.addEventListener( 'wheel', ( e ) => {

		if ( mode === 'zen' ) zoom = THREE.MathUtils.clamp( zoom * Math.exp( e.deltaY * 0.001 ), 0.45, 1.6 );

	}, { passive: true } );

	window.addEventListener( 'resize', () => {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize( window.innerWidth, window.innerHeight );

	} );

	// ---------- 动画 ----------
	const timer = new THREE.Timer();
	timer.connect( document );
	const smoothNdc = new THREE.Vector2();
	const formations = createFormationDirector( u );
	// ?shot=backlit 等参数可固定某个镜头，便于单独查看
	const director = createCameraDirector( camera, params.get( 'shot' ) );
	const events = createEvents( u, camera, formations, director );
	const baseTarget = new THREE.Vector3();

	// ---------- look settings (tuning panel only with ?panel) ----------
	const sunAzimuth = Math.atan2( SUN_DIR.z, SUN_DIR.x );
	let exposureScale = 1;
	const urlShot = params.get( 'shot' );
	const zenEvents = { autoBurst: true, autoFlyby: true };

	function applyEventSettings() {

		// the hunt needs a steady camera and a school that only reacts to the shark
		const inHunt = mode === 'hunt' || mode === 'paused' || mode === 'over';
		events.state.autoBurst = ! inHunt && zenEvents.autoBurst;
		events.state.autoFlyby = mode === 'zen' && zenEvents.autoFlyby;
		if ( ! events.state.autoFlyby ) events.cancel();

	}

	const applyLook = ( p ) => {

		fishBrightness.value = p.fishBrightness;
		scene.environmentIntensity = p.envIntensity;
		ambient.intensity = p.ambient;
		post.rayStrength.value = p.rays;
		post.bloom.strength.value = p.bloom;
		post.dream.value = p.dream;
		waterDensity.value = p.density;
		const el = THREE.MathUtils.degToRad( p.sunElevation );
		SUN_DIR.set( Math.cos( el ) * Math.cos( sunAzimuth ), Math.sin( el ), Math.cos( el ) * Math.sin( sunAzimuth ) );
		exposureScale = p.exposure;
		formations.forced = p.formation === 'auto' ? null : p.formation;
		director.forced = urlShot || ( p.shot === 'auto' ? null : p.shot );
		zenEvents.autoBurst = p.autoBurst;
		zenEvents.autoFlyby = p.autoFlyby;
		applyEventSettings();

	};

	if ( params.has( 'panel' ) ) createPanel( applyLook, { burstNow: events.burstNow, flybyNow: events.flybyNow }, FISH_COUNT );
	else applyLook( DEFAULTS );

	if ( params.has( 'debug' ) ) window.__debug = { renderer, boids, events, hunt, get mode() {

		return mode;

	}, startHunt };

	let elapsed = 0;
	let started = false;
	let exposure = 0.9;
	const lookAt = new THREE.Vector3();

	renderer.setAnimationLoop( () => {

		// 页面不可见时（切到后台、预览面板被隐藏）跳过渲染，避免对 0 尺寸画布提交绘制
		if ( document.hidden ) return;

		timer.update();
		// paused: freeze the world; the canvas keeps showing the last frame
		if ( mode === 'paused' && started ) return;

		const dt = Math.min( timer.getDelta(), 1 / 30 );
		elapsed += dt;
		const t = elapsed;

		// 汇聚目标沿舒缓的利萨如轨迹游移；受惊爆散、鱼流擦镜等动态事件可临时接管
		baseTarget.set(
			Math.sin( t * 0.071 ) * 16,
			1.5 + Math.sin( t * 0.113 ) * 5,
			Math.sin( t * 0.053 + 1.3 ) * 13
		);
		u.target.value.copy( events.update( dt, baseTarget ) );

		formations.update( dt, t );

		const inHunt = mode === 'hunt';
		goldAmount.value += ( ( inHunt || mode === 'over' ? 1 : 0 ) - goldAmount.value ) * ( 1 - Math.exp( - dt * 2 ) );

		if ( inHunt ) {

			hunt.update( dt );
			lookAt.copy( hunt.focus );
			exposure += ( 0.9 - exposure ) * ( 1 - Math.exp( - dt * 0.5 ) );

		} else {

			// 相机：几种镜头缓慢轮换，随指针轻微视差
			if ( mode === 'zen' && Math.abs( ndc.x ) <= 1 ) smoothNdc.lerp( ndc, 1 - Math.exp( - dt * 1.5 ) );
			else smoothNdc.multiplyScalar( Math.exp( - dt * 1.5 ) );
			const shot = director.update( dt, t, u.target.value, mode === 'zen' ? zoom : 1, smoothNdc );
			lookAt.copy( shot.lookAt );
			exposure = shot.exposure;

		}

		renderer.toneMappingExposure = exposure * exposureScale;

		env.backdrop.position.copy( camera.position );
		sun.target.position.copy( lookAt );
		sun.position.copy( lookAt ).addScaledVector( SUN_DIR, 80 );

		// 云影：阳光强度随鱼群上方的云层缓慢起伏
		cloudTime.value = t;
		const proj = ( SURFACE_Y - lookAt.y ) / SUN_DIR.y;
		const shade = cloudShadeJS( lookAt.x + SUN_DIR.x * proj, lookAt.z + SUN_DIR.z * proj, t );
		sun.intensity = 5.0 * ( 0.52 + 0.48 * shade );

		// 指针射线
		raycaster.setFromCamera( ndc, camera );
		u.rayOrigin.value.copy( raycaster.ray.origin );
		u.rayDir.value.copy( raycaster.ray.direction );
		u.pointerActive.value += ( pointerActive - u.pointerActive.value ) * ( 1 - Math.exp( - dt * 10 ) );
		u.burst.value *= Math.exp( - dt * 5 );

		u.delta.value = dt;
		u.time.value = t;

		u.cameraPos.value.copy( camera.position );

		renderer.compute( boids.update );
		post.render();

		if ( ! started ) {

			started = true;
			msg.style.display = 'none';
			updateBestLabel();
			setMode( 'menu' );

		}

	} );

	// ---------- HUD ----------
	function createHud() {

		const scoreEl = $( 'score' ), timeEl = $( 'time' ), comboEl = $( 'combo' ), toastEl = $( 'toast' );
		const dashEl = $( 'dash' ), dashFill = $( 'dashFill' ), hintEl = $( 'stickHint' );
		const C = 2 * Math.PI * 51;
		dashFill.style.strokeDasharray = `${C}`;
		let last = {};
		let bumpTimer = 0;
		let hintTimer = 0;

		return {
			update( s ) {

				if ( s.score !== last.score ) scoreEl.textContent = s.score;
				const secs = Math.ceil( s.timeLeft );
				if ( secs !== last.secs ) {

					timeEl.textContent = `${Math.floor( secs / 60 )}:${String( secs % 60 ).padStart( 2, '0' )}`;
					timeEl.classList.toggle( 'low', secs <= 10 );

				}

				const comboKey = s.combo > 1 ? `${s.combo}|${s.mult}` : '';
				if ( comboKey !== last.comboKey ) {

					comboEl.classList.toggle( 'on', s.combo > 1 );
					if ( s.combo > 1 ) comboEl.innerHTML = `streak ${s.combo}${s.mult > 1 ? ` · <span class="mult">×${s.mult}</span>` : ''}`;

				}

				dashFill.style.strokeDashoffset = `${C * ( 1 - s.stamina )}`;
				dashEl.classList.toggle( 'locked', !! s.dashLock );
				last = { score: s.score, secs, comboKey };

				if ( hintTimer > 0 && ( hintTimer -= 1 / 60 ) <= 0 ) hintEl.style.opacity = 0;

			},
			bumpScore() {

				scoreEl.classList.add( 'bump' );
				clearTimeout( bumpTimer );
				bumpTimer = setTimeout( () => scoreEl.classList.remove( 'bump' ), 90 );

			},
			toast( text ) {

				toastEl.textContent = text;
				toastEl.classList.remove( 'show' );
				void toastEl.offsetWidth; // restart the animation
				toastEl.classList.add( 'show' );

			},
			hintVisible( v ) {

				hintEl.style.opacity = v ? 1 : 0;
				hintTimer = v ? 4 : 0;

			},
		};

	}

}

main().catch( ( err ) => {

	console.error( err );
	msg.textContent = 'Failed to start: ' + err.message;

} );
