// Hunt mode input: a floating thumb-stick (touch or mouse drag), a dash button, and WASD / arrows + Space for desktop
const STICK_RADIUS = 64;

export function createControls( surface, stickEl, knobEl, dashEl ) {

	const state = {
		x: 0, // -1 (left) .. 1 (right)
		y: 0, // -1 (down) .. 1 (up)
		dash: false,
		enabled: false,
	};

	let stickId = null;
	let ox = 0, oy = 0;
	let dashId = null;
	const keys = new Set();

	const showStick = ( x, y ) => {

		stickEl.style.transform = `translate(${x}px, ${y}px)`;
		stickEl.classList.add( 'on' );
		knobEl.style.transform = 'translate(0px, 0px)';

	};

	surface.addEventListener( 'pointerdown', ( e ) => {

		if ( ! state.enabled || stickId !== null ) return;
		stickId = e.pointerId;
		ox = e.clientX; oy = e.clientY;
		state.x = state.y = 0;
		showStick( ox, oy );
		surface.setPointerCapture?.( e.pointerId );

	} );

	surface.addEventListener( 'pointermove', ( e ) => {

		if ( e.pointerId !== stickId ) return;
		let dx = e.clientX - ox, dy = e.clientY - oy;
		const l = Math.hypot( dx, dy );
		if ( l > STICK_RADIUS ) {

			// the stick follows the thumb when it overshoots, so it never feels stuck
			ox += dx * ( 1 - STICK_RADIUS / l );
			oy += dy * ( 1 - STICK_RADIUS / l );
			dx *= STICK_RADIUS / l; dy *= STICK_RADIUS / l;
			stickEl.style.transform = `translate(${ox}px, ${oy}px)`;

		}

		knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
		state.x = dx / STICK_RADIUS;
		state.y = - dy / STICK_RADIUS;

	} );

	const endStick = ( e ) => {

		if ( e.pointerId !== stickId ) return;
		stickId = null;
		state.x = state.y = 0;
		stickEl.classList.remove( 'on' );

	};

	surface.addEventListener( 'pointerup', endStick );
	surface.addEventListener( 'pointercancel', endStick );

	dashEl.addEventListener( 'pointerdown', ( e ) => {

		e.stopPropagation();
		dashId = e.pointerId;
		dashEl.setPointerCapture?.( e.pointerId );
		dashEl.classList.add( 'down' );

	} );

	const endDash = ( e ) => {

		if ( e.pointerId !== dashId ) return;
		dashId = null;
		dashEl.classList.remove( 'down' );

	};

	dashEl.addEventListener( 'pointerup', endDash );
	dashEl.addEventListener( 'pointercancel', endDash );

	window.addEventListener( 'keydown', ( e ) => keys.add( e.code ) );
	window.addEventListener( 'keyup', ( e ) => keys.delete( e.code ) );
	window.addEventListener( 'blur', () => keys.clear() );

	return {
		state,
		// merge keyboard into the stick values once per frame
		poll() {

			const kx = ( keys.has( 'KeyD' ) || keys.has( 'ArrowRight' ) ? 1 : 0 ) - ( keys.has( 'KeyA' ) || keys.has( 'ArrowLeft' ) ? 1 : 0 );
			const ky = ( keys.has( 'KeyW' ) || keys.has( 'ArrowUp' ) ? 1 : 0 ) - ( keys.has( 'KeyS' ) || keys.has( 'ArrowDown' ) ? 1 : 0 );
			const kd = keys.has( 'Space' ) || keys.has( 'ShiftLeft' ) || keys.has( 'ShiftRight' );
			return {
				x: stickId !== null ? state.x : kx,
				y: stickId !== null ? state.y : ky,
				dash: dashId !== null || kd,
			};

		},
		reset() {

			stickId = dashId = null;
			state.x = state.y = 0;
			stickEl.classList.remove( 'on' );
			dashEl.classList.remove( 'down' );
			keys.clear();

		},
	};

}
