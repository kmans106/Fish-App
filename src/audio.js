// Tiny synthesized soundscape (no audio files): a muffled underwater rumble plus gulp / chime / dash cues.
// The AudioContext is created on the first user gesture, as iOS requires.
let ctx = null;
let master = null;
let rumble = null;
let muted = false;

function noiseBuffer( seconds ) {

	const buf = ctx.createBuffer( 1, ctx.sampleRate * seconds, ctx.sampleRate );
	const d = buf.getChannelData( 0 );
	let last = 0;
	for ( let i = 0; i < d.length; i ++ ) {

		// brown noise
		last = ( last + 0.02 * ( Math.random() * 2 - 1 ) ) / 1.02;
		d[ i ] = last * 3.5;

	}

	return buf;

}

export const audio = {

	unlock() {

		if ( ctx ) {

			if ( ctx.state !== 'running' ) ctx.resume().catch( () => {} );
			return;

		}

		const AC = window.AudioContext || window.webkitAudioContext;
		if ( ! AC ) return;
		ctx = new AC();
		master = ctx.createGain();
		master.gain.value = muted ? 0 : 0.8;
		master.connect( ctx.destination );

		// ambient: looping brown noise through a low-pass whose cutoff slowly breathes
		const src = ctx.createBufferSource();
		src.buffer = noiseBuffer( 4 );
		src.loop = true;
		const lp = ctx.createBiquadFilter();
		lp.type = 'lowpass';
		lp.frequency.value = 320;
		const lfo = ctx.createOscillator();
		lfo.frequency.value = 0.07;
		const lfoGain = ctx.createGain();
		lfoGain.gain.value = 140;
		lfo.connect( lfoGain ).connect( lp.frequency );
		rumble = ctx.createGain();
		rumble.gain.value = 0.35;
		src.connect( lp ).connect( rumble ).connect( master );
		src.start();
		lfo.start();

	},

	suspend() {

		ctx?.suspend().catch( () => {} );

	},

	resume() {

		ctx?.resume().catch( () => {} );

	},

	get muted() {

		return muted;

	},

	set muted( v ) {

		muted = v;
		if ( master ) master.gain.setTargetAtTime( v ? 0 : 0.8, ctx.currentTime, 0.05 );

	},

	// rumble swells while dashing
	setIntensity( k ) {

		if ( rumble ) rumble.gain.setTargetAtTime( 0.35 + k * 0.45, ctx.currentTime, 0.15 );

	},

	gulp( combo = 1 ) {

		if ( ! ctx || muted ) return;
		const t = ctx.currentTime;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = 'sine';
		const f = 170 + Math.min( combo, 10 ) * 18;
		o.frequency.setValueAtTime( f, t );
		o.frequency.exponentialRampToValueAtTime( f * 0.38, t + 0.12 );
		g.gain.setValueAtTime( 0.0001, t );
		g.gain.exponentialRampToValueAtTime( 0.32, t + 0.01 );
		g.gain.exponentialRampToValueAtTime( 0.0001, t + 0.16 );
		o.connect( g ).connect( master );
		o.start( t );
		o.stop( t + 0.2 );

	},

	chime() {

		if ( ! ctx || muted ) return;
		const t = ctx.currentTime;
		[ 784, 1175, 1568 ].forEach( ( f, i ) => {

			const o = ctx.createOscillator();
			const g = ctx.createGain();
			o.type = 'triangle';
			o.frequency.value = f;
			const s = t + i * 0.07;
			g.gain.setValueAtTime( 0.0001, s );
			g.gain.exponentialRampToValueAtTime( 0.16, s + 0.01 );
			g.gain.exponentialRampToValueAtTime( 0.0001, s + 0.6 );
			o.connect( g ).connect( master );
			o.start( s );
			o.stop( s + 0.65 );

		} );

	},

	whoosh() {

		if ( ! ctx || muted ) return;
		const t = ctx.currentTime;
		const src = ctx.createBufferSource();
		src.buffer = noiseBuffer( 0.6 );
		const bp = ctx.createBiquadFilter();
		bp.type = 'bandpass';
		bp.Q.value = 0.8;
		bp.frequency.setValueAtTime( 300, t );
		bp.frequency.exponentialRampToValueAtTime( 1400, t + 0.35 );
		const g = ctx.createGain();
		g.gain.setValueAtTime( 0.0001, t );
		g.gain.exponentialRampToValueAtTime( 0.5, t + 0.08 );
		g.gain.exponentialRampToValueAtTime( 0.0001, t + 0.55 );
		src.connect( bp ).connect( g ).connect( master );
		src.start( t );

	},

};
