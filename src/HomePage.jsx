import { useRef, useEffect, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import { TextPlugin } from 'gsap/TextPlugin';
import './HomePage.css';
import Controls from './Controls';
import WebEvolution from './WebEvolution';

// Register GSAP plugins
gsap.registerPlugin(ScrollTrigger, ScrollToPlugin, TextPlugin);

const HomePage = ({ onStartGame, onTimeTrial, onOpenLobby }) => {
  const headerRef = useRef(null);
  const heroRef = useRef(null);
  const featuresRef = useRef(null);
  const techRef = useRef(null);
  const evolutionRef = useRef(null);
  const infinityRef = useRef(null);
  const githubRef = useRef(null);
  const ctaRef = useRef(null);
  const heroTitleRef = useRef(null);
  
  // Game control states
  const [showControls, setShowControls] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [selectedMode, setSelectedMode] = useState(null);
  const countdownRef = useRef(null);

  useEffect(() => {
    // Header animation - simpler and smoother
    gsap.from(headerRef.current, {
      opacity: 0,
      y: -20,
      duration: 0.7,
      ease: "power2.out"
    });

    // Hero section animations - cleaner and less overwhelming
    gsap.from(heroRef.current.querySelector('.hero-content'), {
      opacity: 0,
      y: 30,
      duration: 0.8,
      ease: "power2.out"
    });
    
    gsap.from(heroRef.current.querySelector('.hero-image'), {
      opacity: 0,
      x: 30,
      duration: 0.8,
      delay: 0.2,
      ease: "power2.out"
    });

    // Play button animation - subtle but attention-grabbing
    gsap.to('.play-button', {
      scale: 1.05,
      duration: 1.2,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut"
    });

    // Features section - staggered for better readability
    ScrollTrigger.batch('.feature-card', {
      interval: 0.1,
      onEnter: batch => gsap.to(batch, {
        opacity: 1,
        y: 0,
        stagger: 0.1,
        duration: 0.6,
        ease: "power3.out"
      }),
      start: "top 85%",
    });

    // Tech section - subtle animations
    ScrollTrigger.batch('.tech-card', {
      interval: 0.1,
      onEnter: batch => gsap.to(batch, {
        opacity: 1,
        y: 0,
        stagger: 0.1,
        duration: 0.6,
        ease: "power2.out"
      }),
      start: "top 80%",
    });

    // Infinity section - smoother animations
    ScrollTrigger.create({
      trigger: infinityRef.current,
      start: "top 80%",
      onEnter: () => {
        gsap.to(infinityRef.current.querySelectorAll('.animate-in'), {
          opacity: 1,
          y: 0,
          stagger: 0.1,
          duration: 0.7,
          ease: "power2.out"
        });
      }
    });

    // CTA section - clean animation
    ScrollTrigger.create({
      trigger: ctaRef.current,
      start: "top 80%",
      onEnter: () => {
        gsap.to(ctaRef.current.querySelectorAll('.animate-in'), {
          opacity: 1,
          y: 0,
          stagger: 0.1,
          duration: 0.7,
          ease: "power2.out"
        });
      }
    });

    // GitHub section animations
    ScrollTrigger.create({
      trigger: githubRef.current,
      start: "top 80%",
      onEnter: () => {
        gsap.from(githubRef.current.querySelector('.github-title'), {
          opacity: 0,
          y: 30,
          duration: 0.7,
          ease: "power2.out"
        });
        
        gsap.from(githubRef.current.querySelector('.github-description'), {
          opacity: 0,
          y: 30,
          duration: 0.7,
          delay: 0.2,
          ease: "power2.out"
        });
        
        gsap.from(githubRef.current.querySelectorAll('.github-feature'), {
          opacity: 0,
          y: 30,
          stagger: 0.1,
          duration: 0.5,
          delay: 0.3,
          ease: "power2.out"
        });
        
        gsap.from(githubRef.current.querySelector('.github-button'), {
          opacity: 0,
          y: 20,
          scale: 0.9,
          duration: 0.7,
          delay: 0.6,
          ease: "back.out(1.5)"
        });
        
        gsap.from(githubRef.current.querySelector('.github-decoration'), {
          opacity: 0,
          x: 50,
          duration: 0.9,
          delay: 0.3,
          ease: "power2.out"
        });
        
        // Animate code typing effect
        const codeLines = githubRef.current.querySelectorAll('.code-line');
        gsap.from(codeLines, {
          opacity: 0,
          x: -20,
          stagger: 0.1,
          duration: 0.3,
          delay: 0.7,
          ease: "power1.out"
        });
      }
    });
  }, []);

  // Handle countdown animation
  useEffect(() => {
    if (countdown !== null) {
      const countdownElement = document.getElementById('countdown');
      if (countdownElement) {
        countdownElement.textContent = countdown;
        
        gsap.fromTo(countdownElement, 
          { scale: 1.5, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.3, ease: "back.out" }
        );
      }
      
      if (countdown === 0) {
        // Start the appropriate game mode
        if (selectedMode === 'regular') {
          onStartGame();
        } else if (selectedMode === 'timeTrial') {
          onTimeTrial();
        }
      }
    }
  }, [countdown, selectedMode, onStartGame, onTimeTrial]);

  const startCountdown = (mode) => {
    setSelectedMode(mode);
    setCountdown(3);
    
    // Start countdown
    countdownRef.current = setInterval(() => {
      setCountdown(prevCount => {
        if (prevCount <= 1) {
          clearInterval(countdownRef.current);
          return 0;
        }
        return prevCount - 1;
      });
    }, 1000);
  };
  
  const handleRegularStart = () => {
    if (showControls) {
      startCountdown('regular');
    } else {
      setShowControls(true);
    }
  };

  const handleTimeTrialStart = () => {
    if (showControls) {
      startCountdown('timeTrial');
    } else {
      setShowControls(true);
    }
  };
  
  const scrollToSection = (sectionRef) => {
    gsap.to(window, {
      duration: 0.8,
      scrollTo: { y: sectionRef.current, offsetY: 80 },
      ease: "power3.inOut"
    });
  };

  return (
    <div className="home-page">
      <header ref={headerRef} className="home-header">
        <div className="logo">
          <h1>Mario Kart 3.js</h1>
        </div>
        <nav className="header-nav">
          <ul>
            <li onClick={() => scrollToSection(heroRef)}>Home</li>
            <li onClick={() => scrollToSection(featuresRef)}>Features</li>
            <li onClick={() => scrollToSection(techRef)}>Technology</li>
            <li onClick={() => scrollToSection(evolutionRef)}>Web Evolution</li>
            <li onClick={() => scrollToSection(infinityRef)}>About</li>
            <li onClick={() => scrollToSection(githubRef)}>GitHub</li>
          </ul>
        </nav>
      </header>

      {showControls && (
        <div className="controls-modal">
          <div className="controls-content">
            <h2>Game Controls</h2>
            <div className="controls-grid">
              <div className="control-item">
                <div className="key">W</div>
                <span>Accelerate</span>
              </div>
              <div className="control-item">
                <div className="key">A / D</div>
                <span>Steer Left / Right</span>
              </div>
              <div className="control-item">
                <div className="key">SPACE</div>
                <span>Drift (Hold)</span>
              </div>
              <div className="control-item">
                <div className="key">E</div>
                <span>Use Item</span>
              </div>
              <div className="control-item">
                <div className="key">G</div>
                <span>Drop Bomb</span>
              </div>
              <div className="control-item">
                <div className="key">R</div>
                <span>Reset to nearest road</span>
              </div>
              <div className="control-item">
                <div className="key">Q</div>
                <span>Look Behind (Hold)</span>
              </div>
            </div>
            <p className="control-info">On mobile, use the on-screen controls to play!</p>
            
            {countdown !== null ? (
              <div className="start-countdown">
                <p>
                  {countdown > 0 
                    ? `The game will start in `
                    : `Let's go! `}
                  <span id="countdown" className="countdown-number">
                    {countdown > 0 ? countdown : "GO!"}
                  </span>
                </p>
              </div>
            ) : (
              <div className="control-buttons">
                <button onClick={() => handleRegularStart()} className="start-game-btn">
                  Start Game
                </button>
                <button onClick={() => handleTimeTrialStart()} className="start-trial-btn">
                  Start Time Trial
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <main>
        <section ref={heroRef} className="hero-section">
          <div className="hero-content">
            <h2 ref={heroTitleRef}>Experience Mario Kart in your browser</h2>
            <p className="hero-subtitle">Race in a 3D WebGL-powered kart racing game built with modern web technologies</p>
            <div className="hero-buttons">
              <button onClick={handleRegularStart} className="play-button primary-btn">
                <span>Play Now</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
              </button>
              <button onClick={handleTimeTrialStart} className="secondary-btn">Time Trial</button>
              <button onClick={onOpenLobby} className="lobby-btn">Create Lobby</button>
            </div>
          </div>
          <div className="hero-image">
            <img src="/images/mario-kart-8-arcade-racing_1920x1200.jpg" alt="Mario Kart Game" />
            <div className="hero-badge">3D Tech Demo</div>
          </div>
        </section>

        <section ref={featuresRef} className="features-section">
          <h2 className="section-title">Game Features</h2>
          <div className="features-grid">
            <div className="feature-card" style={{opacity: 0, transform: 'translateY(20px)'}}>
              <h3>3D Physics</h3>
              <p>Experience smooth driving physics and drift mechanics powered by WebGL.</p>
            </div>
            <div className="feature-card" style={{opacity: 0, transform: 'translateY(20px)'}}>
              <h3>Time Trial</h3>
              <p>Challenge yourself to beat your best lap time with accurate timing.</p>
            </div>
            <div className="feature-card" style={{opacity: 0, transform: 'translateY(20px)'}}>
              <h3>Cross-Platform</h3>
              <p>Play with keyboard on desktop or touch controls on mobile devices.</p>
            </div>
            <div className="feature-card" style={{opacity: 0, transform: 'translateY(20px)'}}>
              <h3>Particle Effects</h3>
              <p>Custom WebGL shaders create realistic drift smoke and visual effects.</p>
            </div>
          </div>
        </section>
        
        <section ref={techRef} className="tech-section">
          <h2 className="section-title">Powered by Modern Web Tech</h2>
          
          <div className="tech-cards">
            <div className="tech-card" style={{opacity: 0, transform: 'translateY(20px)'}}>
              <h3>Three.js</h3>
              <p>3D rendering with WebGL for complex scenes, lighting, and camera effects.</p>
            </div>
            
            <div className="tech-card" style={{opacity: 0, transform: 'translateY(20px)'}}>
              <h3>React & Fiber</h3>
              <p>Component-based architecture for building interactive 3D scenes.</p>
            </div>
            
            <div className="tech-card" style={{opacity: 0, transform: 'translateY(20px)'}}>
              <h3>WebGL</h3>
              <p>Hardware-accelerated graphics rendering for high-performance visuals.</p>
            </div>
            
            <div className="tech-card" style={{opacity: 0, transform: 'translateY(20px)'}}>
              <h3>Custom Shaders</h3>
              <p>GLSL shader programs for visual effects like drift smoke and particles.</p>
            </div>
          </div>
          
          <div className="tech-image">
            <img src="/snes.webp" alt="Game Technology" />
          </div>
        </section>

        <div ref={evolutionRef}>
          <WebEvolution />
        </div>
        
        <section ref={infinityRef} className="infinity-section">
          <div className="infinity-content">
            <h2 className="animate-in" style={{opacity: 0, transform: 'translateY(20px)'}}>Developed by Infinity Cybertech</h2>
            <p className="infinity-subtitle animate-in" style={{opacity: 0, transform: 'translateY(20px)'}}>Specialists in 3D Web & Mobile Technology</p>
            <p className="animate-in" style={{opacity: 0, transform: 'translateY(20px)'}}>
              At Infinity Cybertech, we transform digital experiences with cutting-edge
              3D web technology. This demo showcases our expertise in
              building immersive, interactive applications.
            </p>
            <div className="infinity-specialties animate-in" style={{opacity: 0, transform: 'translateY(20px)'}}>
              <span>WebGL</span>
              <span>3D Visualization</span>
              <span>Interactive Apps</span>
              <span>Mobile 3D</span>
            </div>
          </div>
          <div className="infinity-image animate-in" style={{opacity: 0, transform: 'translateY(20px)'}}>
            <img src="/images/mario-kart.avif" alt="3D Web Development" />
            <div className="infinity-overlay">3D Web Experts</div>
          </div>
        </section>

        <section ref={ctaRef} className="cta-section">
          <h2 className="animate-in" style={{opacity: 0, transform: 'translateY(20px)'}}>Ready to Race?</h2>
          <div className="cta-buttons animate-in" style={{opacity: 0, transform: 'translateY(20px)'}}>
            <button onClick={handleRegularStart} className="primary-btn">
              Play Now
            </button>
            <button onClick={handleTimeTrialStart} className="secondary-btn">
              Time Trial Mode
            </button>
          </div>
        </section>
        
        <section ref={githubRef} className="github-section">
          <div className="github-container">
            <div className="github-content">
              <h2 className="github-title">Open Source Project</h2>
              <p className="github-description">
                This Mario Kart 3.js demo is an open-source project. Explore the source code, fork the project,
                or use it as a learning resource.
              </p>
              <div className="github-features">
                <div className="github-feature">
                  <span>View Source Code</span>
                </div>
                <div className="github-feature">
                  <span>Fork Repository</span>
                </div>
                <div className="github-feature">
                  <span>Star Project</span>
                </div>
                <div className="github-feature">
                  <span>Report Issues</span>
                </div>
              </div>
              <a href="https://github.com/Basem321/Mario-Kart.git" target="_blank" rel="noopener noreferrer" className="github-button">
                <svg className="github-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.30.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                <span>Made by basem</span>
              </a>
              <p className="github-credit">
                Special thanks to{' '}
                <a href="https://github.com/Nathan-Richard-21" target="_blank" rel="noopener noreferrer">
                  Nathan-Richard-21
                </a>
              </p>
            </div>
            <div className="github-decoration">
              <div className="code-block">
                <div className="code-line"><span className="code-comment">&#47;&#47; Clone the Mario-Kart repository</span></div>
                <div className="code-line"><span className="code-keyword">git</span> clone https://github.com/Basem321/Mario-Kart.git</div>
                <div className="code-line"><span className="code-keyword">cd</span> Mario-Kart</div>
                <div className="code-line"><span className="code-keyword">npm</span> install</div>
                <div className="code-line"><span className="code-keyword">npm</span> run dev</div>
                <div className="code-line indent"><span className="code-comment">&#47;&#47; Start racing in 3D</span></div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="home-footer">
        <div className="footer-content">
          <div className="footer-logo">
            <h3>Mario Kart 3.js</h3>
            <p>A 3D Web Technology Demo</p>
          </div>
          <div className="footer-links">
            <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection(heroRef); }}>Home</a>
            <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection(featuresRef); }}>Features</a>
            <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection(techRef); }}>Technology</a>
            <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection(evolutionRef); }}>Web Evolution</a>
            <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection(infinityRef); }}>About</a>
            <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection(githubRef); }}>GitHub</a>
            <a href="https://github.com/Basem321/Mario-Kart.git" target="_blank" rel="noopener noreferrer">View Source</a>
          </div>
          <div className="footer-bottom">
            <p>&copy; {new Date().getFullYear()} Infinity Cybertech. All rights reserved.</p>
            <p>This is a non-profit fan project. Mario Kart is a trademark of Nintendo Co., Ltd.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default HomePage;
