// Hunt mode: the player's predator — a procedural reef shark with a swimming tail wave
import * as THREE from 'three/webgpu';
import {
	Fn, positionLocal, normalLocal, positionGeometry, positionWorld, normalWorld, attribute, uniform,
	vec2, vec3, float, sin, cos, normalize, mix, smoothstep, clamp, length, max, abs,
} from 'three/tsl';
import { causticAt, lightTransmittance } from './ocean.js';

export const PREDATOR_LENGTH = 3.8;

function createPredatorGeometry() {

	const pos = [];
	const nor = [];
	const part = [];
	const idx = [];

	const RINGS = 24;
	const SEG = 16;
	const zNose = 0.5;
	const zTail = - 0.36;

	// torpedo body: blunt snout, thick shoulders, long tapering tail stock
	const profileH = ( t ) => Math.max( 0.21 * Math.pow( t, 0.42 ) * Math.pow( 1 - t, 1.05 ), 0.012 );
	const profileW = ( t ) => profileH( t ) * ( 0.95 - 0.35 * t );

	pos.push( 0, - 0.006, zNose + 0.01 );
	nor.push( 0, 0, 1 );
	part.push( 0 );

	for ( let r = 0; r < RINGS; r ++ ) {

		const t = 0.02 + ( r / ( RINGS - 1 ) ) * 0.98;
		const z = zNose + ( zTail - zNose ) * t;
		const h = profileH( t );
		const w = profileW( t );

		for ( let s = 0; s < SEG; s ++ ) {

			const a = ( s / SEG ) * Math.PI * 2;
			const sy = Math.sin( a );
			// flatter belly, rounded back; snout slightly lower than the back line
			const y = sy * h * ( sy > 0 ? 1.0 : 0.78 ) - 0.012 * ( 1 - t );
			pos.push( Math.cos( a ) * w, y, z );
			nor.push( Math.cos( a ) / Math.max( w, 1e-3 ), sy / Math.max( h, 1e-3 ), 0 );
			part.push( 0 );

		}

	}

	const ring = ( r, s ) => 1 + r * SEG + ( ( s + SEG ) % SEG );
	for ( let s = 0; s < SEG; s ++ ) idx.push( 0, ring( 0, s + 1 ), ring( 0, s ) );
	for ( let r = 0; r < RINGS - 1; r ++ ) {

		for ( let s = 0; s < SEG; s ++ ) {

			const a = ring( r, s ), b = ring( r, s + 1 ), c = ring( r + 1, s ), d = ring( r + 1, s + 1 );
			idx.push( a, b, c, b, d, c );

		}

	}

	const tailCenter = pos.length / 3;
	pos.push( 0, 0, zTail - 0.005 );
	nor.push( 0, 0, - 1 );
	part.push( 0 );
	for ( let s = 0; s < SEG; s ++ ) idx.push( tailCenter, ring( RINGS - 1, s ), ring( RINGS - 1, s + 1 ) );

	// normalise the ellipse normals
	for ( let i = 0; i < nor.length; i += 3 ) {

		const l = Math.hypot( nor[ i ], nor[ i + 1 ], nor[ i + 2 ] ) || 1;
		nor[ i ] /= l; nor[ i + 1 ] /= l; nor[ i + 2 ] /= l;

	}

	// fins (double-sided triangles), part = 1
	const tri = ( a, b, c ) => {

		const base = pos.length / 3;
		pos.push( ...a, ...b, ...c );
		const n = new THREE.Vector3().crossVectors(
			new THREE.Vector3( ...b ).sub( new THREE.Vector3( ...a ) ),
			new THREE.Vector3( ...c ).sub( new THREE.Vector3( ...a ) )
		).normalize();
		for ( let i = 0; i < 3; i ++ ) {

			nor.push( n.x, n.y, n.z );
			part.push( 1 );

		}

		idx.push( base, base + 1, base + 2 );

	};

	const tb = zTail + 0.03;
	// crescent tail: tall upper lobe, shorter lower lobe
	tri( [ 0, 0.014, tb ], [ 0, 0.2, - 0.6 ], [ 0, 0.02, - 0.47 ] );
	tri( [ 0, 0.014, tb ], [ 0, 0.02, - 0.47 ], [ 0, - 0.014, tb ] );
	tri( [ 0, - 0.014, tb ], [ 0, 0.02, - 0.47 ], [ 0, - 0.12, - 0.54 ] );
	// dorsal fin
	tri( [ 0, 0.075, 0.12 ], [ 0, 0.22, - 0.02 ], [ 0, 0.07, - 0.05 ] );
	tri( [ 0, 0.07, - 0.05 ], [ 0, 0.22, - 0.02 ], [ 0, 0.16, - 0.07 ] );
	// second dorsal + anal fin
	tri( [ 0, 0.035, - 0.2 ], [ 0, 0.07, - 0.25 ], [ 0, 0.03, - 0.26 ] );
	tri( [ 0, - 0.03, - 0.2 ], [ 0, - 0.062, - 0.25 ], [ 0, - 0.026, - 0.26 ] );
	// pectoral fins: wide, swept back, angled down
	for ( const sx of [ - 1, 1 ] ) {

		tri( [ sx * 0.05, - 0.03, 0.24 ], [ sx * 0.24, - 0.11, 0.06 ], [ sx * 0.05, - 0.035, 0.12 ] );
		tri( [ sx * 0.05, - 0.035, 0.12 ], [ sx * 0.24, - 0.11, 0.06 ], [ sx * 0.2, - 0.1, 0.03 ] );

	}

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'normal', new THREE.Float32BufferAttribute( nor, 3 ) );
	g.setAttribute( 'part', new THREE.Float32BufferAttribute( part, 1 ) );
	g.setIndex( idx );
	return g;

}

export function createPredator() {

	const phase = uniform( 0 );
	const swing = uniform( 1 );
	const gulp = uniform( 0 );

	const material = new THREE.MeshPhysicalNodeMaterial( { side: THREE.DoubleSide, clearcoat: 0.35, clearcoatRoughness: 0.4 } );

	material.positionNode = Fn( () => {

		const local = positionLocal.toVar();
		const n = normalLocal.toVar();

		// travelling body wave, strongest at the tail
		const along = clamp( float( 0.45 ).sub( local.z ), 0, 1.15 );
		const amp = along.mul( along ).mul( 0.11 ).add( 0.004 ).mul( swing );
		const k = float( 4.2 );
		const wave = phase.sub( along.mul( k ) );
		local.x.addAssign( sin( wave ).mul( amp ) );
		const slope = cos( wave ).mul( amp ).mul( k );
		n.assign( normalize( vec3( n.x, n.y, n.z.add( n.x.mul( slope ) ) ) ) );

		// gulp: the head swells briefly when it eats
		const head = smoothstep( 0.1, 0.45, local.z ).mul( gulp ).mul( 0.18 );
		local.x.mulAssign( head.add( 1 ) );
		local.y.mulAssign( head.add( 1 ) );

		normalLocal.assign( n );
		return local;

	} )();

	const g = positionGeometry;
	const part = attribute( 'part', 'float' );

	material.colorNode = Fn( () => {

		// countershading: slate-blue back, pale belly, soft wavy boundary
		const back = vec3( 0.07, 0.11, 0.14 );
		const flank = vec3( 0.22, 0.28, 0.32 );
		const belly = vec3( 0.8, 0.82, 0.8 );
		const edge = g.y.add( sin( g.z.mul( 22 ) ).mul( 0.006 ) );
		const c = mix( belly, flank, smoothstep( - 0.03, - 0.005, edge ) ).toVar();
		c.assign( mix( c, back, smoothstep( 0.0, 0.05, edge ) ) );

		// gill slits
		const gz = g.z.sub( 0.27 );
		const slit = float( 0 ).toVar();
		for ( let i = 0; i < 4; i ++ ) {

			slit.assign( max( slit, float( 1 ).sub( smoothstep( 0.0, 0.004, abs( gz.add( i * 0.022 ) ) ) ).mul( smoothstep( 0.02, 0.04, abs( g.x ) ) ).mul( smoothstep( - 0.04, - 0.01, g.y ) ).mul( float( 1 ).sub( smoothstep( 0.02, 0.04, g.y ) ) ) ) );

		}

		c.assign( mix( c, vec3( 0.03, 0.04, 0.05 ), slit.mul( 0.7 ) ) );

		// eyes
		const eyeR = length( vec2( g.y.sub( 0.012 ), g.z.sub( 0.4 ) ) );
		const onSide = smoothstep( 0.02, 0.035, abs( g.x ) );
		c.assign( mix( c, vec3( 0.003 ), float( 1 ).sub( smoothstep( 0.008, 0.011, eyeR ) ).mul( onSide ) ) );

		// fins: darker with pale trailing tips
		const finTip = smoothstep( 0.12, 0.2, abs( g.y ).add( abs( g.x ) ) );
		c.assign( mix( c, mix( vec3( 0.08, 0.12, 0.15 ), vec3( 0.5, 0.55, 0.55 ), finTip.mul( 0.6 ) ), part ) );
		return c;

	} )();

	const causticLight = causticAt( positionWorld ).mul( max( normalWorld.y, 0 ) ).mul( 0.6 );
	material.colorNode = material.colorNode.mul( mix( vec3( 1 ), lightTransmittance( positionWorld.y ), 0.5 ) ).mul( causticLight.add( 1 ) );
	material.roughnessNode = mix( float( 0.45 ), float( 0.6 ), part );
	material.metalnessNode = float( 0.15 );

	const mesh = new THREE.Mesh( createPredatorGeometry(), material );
	mesh.scale.setScalar( PREDATOR_LENGTH );
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.frustumCulled = false;

	const object = new THREE.Group();
	object.add( mesh );
	object.visible = false;

	let gulpT = 0;

	return {
		object,
		// speed: current swim speed, used for tail-beat frequency
		update( dt, speed ) {

			phase.value = ( phase.value + dt * ( 2.2 + speed * 0.55 ) ) % ( Math.PI * 200 );
			swing.value += ( THREE.MathUtils.clamp( 0.6 + speed * 0.04, 0.6, 1.4 ) - swing.value ) * ( 1 - Math.exp( - dt * 4 ) );
			gulpT = Math.max( 0, gulpT - dt * 5 );
			gulp.value = Math.sin( Math.min( gulpT, 1 ) * Math.PI );

		},
		gulp() {

			gulpT = 1;

		},
	};

}
