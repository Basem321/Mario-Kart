import { useRef, useEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import './WebEvolution.css';

gsap.registerPlugin(ScrollTrigger, MotionPathPlugin);

const WebEvolution = () => {
  const sectionRef = useRef(null);
  const titleRef = useRef(null);
  const timelineRef = useRef(null);
  const cardsRef = useRef([]);
  const imageRefs = useRef([]);
  
  useEffect(() => {
    // Title animation with gradient text reveal
    gsap.fromTo(
      titleRef.current,
      { 
        backgroundSize: "0% 100%",
        opacity: 0,
        y: 30
      },
      {
        backgroundSize: "100% 100%",
        opacity: 1,
        y: 0,
        duration: 1.2,
        scrollTrigger: {
          trigger: titleRef.current,
          start: "top 80%",
        }
      }
    );
    
    // Timeline bar animation
    gsap.fromTo(
      timelineRef.current,
      { width: "0%" },
      {
        width: "100%",
        duration: 2,
        ease: "power2.inOut",
        scrollTrigger: {
          trigger: timelineRef.current,
          start: "top 75%",
        }
      }
    );
    
    // Animate each evolution card
    cardsRef.current.forEach((card, index) => {
      gsap.fromTo(
        card,
        { 
          x: index % 2 === 0 ? -50 : 50, 
          opacity: 0 
        },
        {
          x: 0,
          opacity: 1,
          duration: 0.8,
          delay: 0.2 * index,
          ease: "power2.out",
          scrollTrigger: {
            trigger: card,
            start: "top 85%",
          }
        }
      );
    });
    
    // Animate each image with parallax effect
    imageRefs.current.forEach((img, index) => {
      gsap.fromTo(
        img,
        { 
          y: 50,
          opacity: 0,
          scale: 0.9
        },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          duration: 1,
          delay: 0.3 * index,
          ease: "power3.out",
          scrollTrigger: {
            trigger: img,
            start: "top 85%",
          }
        }
      );
      
      // Parallax effect on scroll
      gsap.to(img, {
        y: -20,
        ease: "none",
        scrollTrigger: {
          trigger: img,
          start: "top bottom",
          end: "bottom top",
          scrub: 0.5
        }
      });
    });
    
    // Interactive hover animations for cards
    const cards = document.querySelectorAll('.evolution-card');
    cards.forEach(card => {
      card.addEventListener('mouseenter', () => {
        gsap.to(card, {
          y: -10,
          boxShadow: "0 20px 30px rgba(0, 0, 0, 0.3)",
          duration: 0.3,
          ease: "power2.out"
        });
        
        // Animate the glow effect
        gsap.to(card.querySelector('.card-glow'), {
          opacity: 0.8,
          duration: 0.4
        });
      });
      
      card.addEventListener('mouseleave', () => {
        gsap.to(card, {
          y: 0,
          boxShadow: "0 10px 20px rgba(0, 0, 0, 0.2)",
          duration: 0.5,
          ease: "power3.out"
        });
        
        // Hide glow effect
        gsap.to(card.querySelector('.card-glow'), {
          opacity: 0,
          duration: 0.4
        });
      });
    });
  }, []);
  
  // Function to add elements to refs array
  const addToCardsRef = (el) => {
    if (el && !cardsRef.current.includes(el)) {
      cardsRef.current.push(el);
    }
  };
  
  const addToImagesRef = (el) => {
    if (el && !imageRefs.current.includes(el)) {
      imageRefs.current.push(el);
    }
  };

  return (
    <section className="web-evolution-section" ref={sectionRef}>
      <h2 className="evolution-title" ref={titleRef}>The Evolution of Web Technology</h2>
      
      <div className="timeline">
        <div className="timeline-bar" ref={timelineRef}></div>
      </div>
      
      <div className="evolution-container">
        <div className="evolution-card" ref={addToCardsRef}>
          <div className="card-glow"></div>
          <span className="year">1990s</span>
          <h3>Static Web</h3>
          <p>The early days of the internet featured simple HTML pages with limited styling and functionality. Users could only consume content passively.</p>
        </div>
        
        <div className="evolution-image" ref={addToImagesRef}>
          <img src="/gradient.jpg" alt="Early Web" />
        </div>
        
        <div className="evolution-image" ref={addToImagesRef}>
          <img src="/images/mario-kart-tour.jpg" alt="Interactive Web" />
        </div>
        
        <div className="evolution-card" ref={addToCardsRef}>
          <div className="card-glow"></div>
          <span className="year">2000s</span>
          <h3>Dynamic Web</h3>
          <p>The rise of JavaScript and AJAX enabled interactive elements, allowing users to interact with content without reloading pages.</p>
        </div>
        
        <div className="evolution-card" ref={addToCardsRef}>
          <div className="card-glow"></div>
          <span className="year">2010s</span>
          <h3>Responsive Web</h3>
          <p>Mobile devices drove the need for responsive designs. Websites adapted to different screen sizes and touch interfaces became standard.</p>
        </div>
        
        <div className="evolution-image" ref={addToImagesRef}>
          <img src="/images/mario-kart-world-artwork-01-1280x1024-1.jpg" alt="Responsive Web" />
        </div>
        
        <div className="evolution-image" ref={addToImagesRef}>
          <img src="/images/mario-kart-8-arcade-racing_1920x1200.jpg" alt="3D Web" />
        </div>
        
        <div className="evolution-card" ref={addToCardsRef}>
          <div className="card-glow"></div>
          <span className="year">2020s</span>
          <h3>3D & Immersive Web</h3>
          <p>WebGL and Three.js enable immersive 3D experiences directly in browsers. Virtual spaces and interactive 3D elements create engaging user experiences.</p>
        </div>
      </div>
      
      <div className="future-section">
        <h3 className="future-title">The Future is 3D</h3>
        <div className="future-content">
          <div className="future-text">
            <p>3D web experiences represent the next frontier in digital interaction. As technology advances, we're moving beyond flat designs to immersive, interactive environments that engage users in entirely new ways.</p>
            <p>From virtual showrooms and interactive product displays to immersive storytelling and games like this Mario Kart demo, 3D web technologies are transforming how we interact online.</p>
            <p>With WebGL, Three.js, and modern browsers, developers can create console-quality experiences that run directly in a web browser without plugins or downloads.</p>
          </div>
          
          <div className="future-possibilities">
            <div className="possibility-item">
              <h4>Immersive Gaming</h4>
              <p>Console-quality games running directly in the browser</p>
            </div>
            <div className="possibility-item">
              <h4>Virtual Shopping</h4>
              <p>Interactive 3D product visualization and virtual stores</p>
            </div>
            <div className="possibility-item">
              <h4>Virtual Spaces</h4>
              <p>Navigate 3D environments for social and professional interactions</p>
            </div>
            <div className="possibility-item">
              <h4>Interactive Learning</h4>
              <p>Educational experiences with 3D models and simulations</p>
            </div>
          </div>
        </div>
      </div>
      
      <div className="cta-banner">
        <div className="cta-content">
          <h3>Experience 3D Web Today</h3>
          <p>This Mario Kart demo shows just one possibility. The future of the web is interactive, immersive, and three-dimensional.</p>
        </div>
      </div>
    </section>
  );
};

export default WebEvolution;
