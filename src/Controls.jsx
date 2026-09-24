import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import './Controls.css';

const Controls = ({ onClose }) => {
  const modalRef = useRef(null);
  const contentRef = useRef(null);

  useEffect(() => {
    // Animation for the modal when it appears
    gsap.from(modalRef.current, {
      backgroundColor: 'rgba(0, 0, 0, 0)',
      duration: 0.3
    });
    
    gsap.from(contentRef.current, {
      y: 50,
      opacity: 0,
      scale: 0.9,
      duration: 0.4,
      ease: 'back.out(1.7)'
    });

    // Add keyboard listener for escape key
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        closeModal();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const closeModal = () => {
    gsap.to(contentRef.current, {
      y: 50,
      opacity: 0,
      scale: 0.9,
      duration: 0.3,
      ease: 'power2.in'
    });
    
    gsap.to(modalRef.current, {
      backgroundColor: 'rgba(0, 0, 0, 0)',
      duration: 0.3,
      onComplete: () => onClose()
    });
  };
  
  return (
    <div className="controls-modal-overlay" ref={modalRef}>
      <div className="controls-modal-content" ref={contentRef}>
        <button className="close-btn" onClick={closeModal}>&times;</button>
        
        <h2>Game Controls</h2>
        
        <div className="controls-section">
          <h3>Keyboard Controls</h3>
          <div className="controls-grid">
            <div className="control-item">
              <div className="key-container">
                <div className="key">W</div>
                <div className="key">↑</div>
              </div>
              <span>Accelerate</span>
            </div>
            
            <div className="control-item">
              <div className="key-container">
                <div className="key">S</div>
                <div className="key">↓</div>
              </div>
              <span>Brake/Reverse</span>
            </div>
            
            <div className="control-item">
              <div className="key-container">
                <div className="key">A</div>
                <div className="key">←</div>
              </div>
              <span>Steer Left</span>
            </div>
            
            <div className="control-item">
              <div className="key-container">
                <div className="key">D</div>
                <div className="key">→</div>
              </div>
              <span>Steer Right</span>
            </div>
            
            <div className="control-item">
              <div className="key">Space</div>
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
              <span>Look Behind (Hold)</span>
            </div>
            
            <div className="control-item">
              <div className="key">Mouse</div>
              <span>Steer (Alternative)</span>
            </div>
          </div>
        </div>
        
        <div className="controls-section">
          <h3>Mobile Controls</h3>
          <div className="mobile-controls-info">
            <div className="mobile-control-item">
              <div className="mobile-control-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="9" stroke="white" strokeWidth="2"/>
                  <circle cx="12" cy="12" r="4" fill="white"/>
                </svg>
              </div>
              <span>Left Joystick: Movement/Steering</span>
            </div>
            
            <div className="mobile-control-item">
              <div className="mobile-control-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="10" fill="#58db84" />
                  <text x="12" y="16" fill="white" fontSize="14" fontWeight="bold" textAnchor="middle">A</text>
                </svg>
              </div>
              <span>Action Button: Jump/Drift</span>
            </div>
          </div>
        </div>
        
        <div className="controls-section">
          <h3>Drift Technique</h3>
          <ol className="drift-steps">
            <li>Hold <span className="key-inline">Space</span> while turning</li>
            <li>Steer and counter-steer to maintain the drift</li>
            <li>Release <span className="key-inline">Space</span> after holding for a brief period to get a mini-turbo</li>
          </ol>
        </div>
        
        <div className="button-container">
          <button className="got-it-btn" onClick={closeModal}>Got It!</button>
        </div>
      </div>
    </div>
  );
};

export default Controls;
