// Hunt mode: steer a shark through the school and eat as many fish as you can before time runs out.
// Fish flee from the predator and are eaten on the GPU (see boids.js); the CPU reads back the running totals.
import * as THREE from 'three/webgpu';
import { SURFACE_Y, FLOOR_Y } from './ocean.js';
import { floorHeight } from './environment.js';
import { PREDATOR_LENGTH } from './predator.js';
import { haptics } from './native.js';
import { audio } from './audio.js';

const ROUND_TIME = 60;
const GOLD_POINTS = 10;
const GOLD_TIME_BONUS = 3;
const COMBO_WINDOW = 1.4;
const CRUISE_SPEED = 9.5;
const DASH_SPEED = 21;
const TURN_RATE = 2.1;
const MAX_PITCH = 0.8;
const ARENA_RADIUS = 52;
const BASE_FOV = 62;

export function createHunt( { renderer, boids, camera, predator, controls, hud, roundTime = ROUND_TIME } ) {

	const u = boids.uniforms;
	const pos = new THREE.Vector3();
	const fwd = new THREE.Vector3( 0, 0, 1 );
	const camPos = new THREE.Vector3();
	const camLook = new THREE.Vector3();
	const tmp = new THREE.Vector3();
	const UP = new THREE.Vector3( 0, 1, 0 );

	let yaw = 0, pitch = 0, yawRate = 0, bank = 0, speed = CRUISE_SPEED;
	let stamina = 1, dashing = false, dashLock = false, dashAmount = 0;
	let running = false;
	let timeLeft = roundTime, elapsed = 0;
	let score = 0, combo = 0, comboTimer = 0, bestCombo = 0, caught = 0, goldCaught = 0;
	let onEnd = null;

	// GPU readback of the eaten counters
	let lastCounts = null;
	let pending = false;

	function readback() {

		if ( pending ) return;
		pending = true;
		renderer.getArrayBufferAsync( boids.eaten.value ).then( ( buf ) => {

			const a = new Uint32Array( buf );
			if ( lastCounts && running ) {

				const silver = ( a[ 0 ] - lastCounts[ 0 ] ) >>> 0;
				const gold = ( a[ 1 ] - lastCounts[ 1 ] ) >>> 0;
				if ( silver || gold ) onCatch( silver, gold );

			}

			lastCounts = [ a[ 0 ], a[ 1 ] ];

		} ).catch( () => {} ).finally( () => {

			pending = false;

		} );

	}

	function multiplier() {

		return Math.min( 5, 1 + Math.floor( combo / 8 ) );

	}

	function onCatch( silver, gold ) {

		const n = silver + gold;
		combo += n;
		comboTimer = COMBO_WINDOW;
		bestCombo = Math.max( bestCombo, combo );
		caught += n;
		goldCaught += gold;
		const m = multiplier();
		score += ( silver + gold * GOLD_POINTS ) * m;
		predator.gulp();
		audio.gulp( combo );

		if ( gold ) {

			timeLeft += gold * GOLD_TIME_BONUS;
			haptics.thump();
			audio.chime();
			hud.toast( `GOLDEN +${gold * GOLD_POINTS * m}  ·  +${gold * GOLD_TIME_BONUS}s` );

		} else {

			haptics.tap();

		}

		hud.bumpScore();

	}

	function start( center, endCallback ) {

		onEnd = endCallback;

		// start some distance from the school, facing it
		const a = Math.random() * Math.PI * 2;
		pos.set( center.x + Math.cos( a ) * 30, THREE.MathUtils.clamp( center.y, FLOOR_Y + 8, SURFACE_Y - 8 ), center.z + Math.sin( a ) * 30 );
		const r = Math.hypot( pos.x, pos.z );
		if ( r > ARENA_RADIUS - 4 ) pos.multiplyScalar( ( ARENA_RADIUS - 4 ) / r );
		tmp.subVectors( center, pos );
		yaw = Math.atan2( tmp.x, tmp.z );
		pitch = 0; yawRate = 0; bank = 0;
		speed = CRUISE_SPEED;
		stamina = 1; dashing = false; dashLock = false; dashAmount = 0;
		timeLeft = roundTime; elapsed = 0;
		score = 0; combo = 0; comboTimer = 0; bestCombo = 0; caught = 0; goldCaught = 0;
		updateForward();

		// camera keeps its current position and swoops in behind the shark
		camPos.copy( camera.position );
		camLook.copy( pos );

		predator.object.visible = true;
		controls.reset();
		controls.state.enabled = true;
		running = true;
		hud.update( { score, timeLeft, combo: 0, mult: 1, stamina } );

	}

	function stop() {

		running = false;
		controls.state.enabled = false;
		controls.reset();
		predator.object.visible = false;
		u.eatEnabled.value = 0;
		u.predFear.value = 0;
		u.predPos.value.set( 0, - 500, 0 );
		u.predMouth.value.set( 0, - 500, 0 );
		audio.setIntensity( 0 );
		if ( camera.fov !== BASE_FOV ) {

			camera.fov = BASE_FOV;
			camera.updateProjectionMatrix();

		}

	}

	function updateForward() {

		const cp = Math.cos( pitch );
		fwd.set( Math.sin( yaw ) * cp, Math.sin( pitch ), Math.cos( yaw ) * cp );

	}

	function update( dt ) {

		if ( ! running ) return;

		elapsed += dt;
		timeLeft -= dt;

		const input = controls.poll();

		// ---------- dash with stamina ----------
		const wantDash = input.dash && ! dashLock && stamina > 0.02;
		if ( wantDash && ! dashing ) audio.whoosh();
		dashing = wantDash;
		if ( dashing ) {

			stamina = Math.max( 0, stamina - dt * 0.42 );
			if ( stamina === 0 ) dashLock = true; // must release and recover a little before dashing again

		} else {

			stamina = Math.min( 1, stamina + dt * 0.2 );
			if ( dashLock && stamina > 0.25 && ! input.dash ) dashLock = false;

		}

		dashAmount += ( ( dashing ? 1 : 0 ) - dashAmount ) * ( 1 - Math.exp( - dt * 4 ) );
		speed += ( ( dashing ? DASH_SPEED : CRUISE_SPEED ) - speed ) * ( 1 - Math.exp( - dt * ( dashing ? 3.5 : 1.5 ) ) );
		audio.setIntensity( dashAmount );

		// ---------- steering ----------
		let targetYawRate = - input.x * TURN_RATE * ( 1 - dashAmount * 0.3 );
		let targetPitch = input.y * MAX_PITCH;

		// soft arena walls: turn back toward the middle near the edge
		const r = Math.hypot( pos.x, pos.z );
		if ( r > ARENA_RADIUS ) {

			const home = Math.atan2( - pos.x, - pos.z );
			const diff = Math.atan2( Math.sin( home - yaw ), Math.cos( home - yaw ) );
			targetYawRate += diff * Math.min( 1, ( r - ARENA_RADIUS ) / 6 ) * 3;

		}

		const floor = Math.max( FLOOR_Y + 3, floorHeight( pos.x, pos.z ) + 2.5 );
		const ceiling = SURFACE_Y - 3.5;
		if ( pos.y > ceiling - 3 ) targetPitch = Math.min( targetPitch, - ( pos.y - ( ceiling - 3 ) ) * 0.3 );
		if ( pos.y < floor + 3 ) targetPitch = Math.max( targetPitch, ( floor + 3 - pos.y ) * 0.3 );

		yawRate += ( targetYawRate - yawRate ) * ( 1 - Math.exp( - dt * 6 ) );
		yaw += yawRate * dt;
		pitch += ( THREE.MathUtils.clamp( targetPitch, - MAX_PITCH, MAX_PITCH ) - pitch ) * ( 1 - Math.exp( - dt * 3 ) );
		updateForward();

		pos.addScaledVector( fwd, speed * dt );
		pos.y = THREE.MathUtils.clamp( pos.y, floor, ceiling );

		// ---------- predator mesh ----------
		bank += ( THREE.MathUtils.clamp( - yawRate * 0.32, - 0.6, 0.6 ) - bank ) * ( 1 - Math.exp( - dt * 4 ) );
		predator.object.position.copy( pos );
		predator.object.lookAt( tmp.copy( pos ).add( fwd ) );
		predator.object.rotateZ( bank );
		predator.update( dt, speed );

		// ---------- feed the GPU ----------
		u.predPos.value.copy( pos ).addScaledVector( fwd, 0.6 );
		u.predMouth.value.copy( pos ).addScaledVector( fwd, PREDATOR_LENGTH * 0.5 + 0.15 );
		// the school grows warier as the round goes on
		u.predFearRadius.value = 6 + Math.min( elapsed / roundTime, 1 ) * 2.5;
		u.predFear.value = 1;
		u.eatEnabled.value = elapsed > 0.4 ? 1 : 0;
		readback();

		// ---------- chase camera ----------
		// above and behind, looking down onto the shark's back so its body and tail read clearly
		const camBack = 5.4 + dashAmount * 2.2;
		tmp.copy( fwd ).setY( fwd.y * 0.5 ).normalize();
		const desired = tmp.multiplyScalar( - camBack ).add( pos ).addScaledVector( UP, 3.1 );
		desired.y = THREE.MathUtils.clamp( desired.y, FLOOR_Y + 2, SURFACE_Y - 1.5 );
		const kc = 1 - Math.exp( - dt * ( elapsed < 1.5 ? 2.2 : 5 ) );
		camPos.lerp( desired, kc );
		camLook.lerp( tmp.copy( pos ).addScaledVector( fwd, 3 ), 1 - Math.exp( - dt * 6 ) );
		camera.position.copy( camPos );
		camera.lookAt( camLook );
		const fov = BASE_FOV + dashAmount * 12;
		if ( Math.abs( camera.fov - fov ) > 0.05 ) {

			camera.fov = fov;
			camera.updateProjectionMatrix();

		}

		camera.updateMatrixWorld();

		// ---------- combo & clock ----------
		if ( comboTimer > 0 ) {

			comboTimer -= dt;
			if ( comboTimer <= 0 ) combo = 0;

		}

		hud.update( { score, timeLeft: Math.max( 0, timeLeft ), combo, mult: multiplier(), stamina, dashLock } );

		if ( timeLeft <= 0 ) {

			const result = { score, caught, goldCaught, bestCombo };
			stop();
			haptics.done();
			onEnd?.( result );

		}

	}

	return {
		start, stop, update,
		get running() {

			return running;

		},
		// the point the scene lighting / shadows should centre on
		get focus() {

			return pos;

		},
	};

}
