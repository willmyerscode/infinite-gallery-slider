/**
 * Infinite Slider Plugin for Squarespace List Sections
 * Copyright Will-Myers.com
 * 
 * Transforms a list section into an infinitely scrolling image slider
 * with configurable height, speed, and aspect ratio
 **/

class WMInfiniteSlider {
  static pluginName = 'infinite-slider';
  
  static emitEvent(type, detail = {}, elem = document) {
    elem.dispatchEvent(new CustomEvent(`wm-${this.pluginName}${type}`, { detail, bubbles: true }));
  }

  constructor(el, settings = {}) {
    this.el = el; // The .page-section element
    this.settings = {
      speedMobile: 30, // pixels per second - used for duration calculation
      speedDesktop: 50, // pixels per second - used for duration calculation
      reverse: false, // reverse animation direction
      stopOnHover: true, // pause animation on hover
      allowClickthrough: false, // allow clicking items to navigate to their button link
      clickthroughNewWindow: false, // open clickthrough links in new window
      ...settings
    };
    this.data = null;
    this.sectionTitle = null;
    this.sectionButton = null;
    this.options = null;
    this.styles = null;
    this.originalContainer = null;
    this.pluginName = this.constructor.pluginName;
    this.isBackend = window.top !== window.self;
    this.resizeTimer = null;
    this.imagesLoaded = false;
    
    this.init();
  }

  init() {
    WMInfiniteSlider.emitEvent(':beforeInit', { el: this.el }, this.el);
    this.addDataAttribute();
    this.extractData();
    
    if (!this.data || this.data.length === 0) {
      console.warn(`[${this.pluginName}] No items found`);
      return;
    }
    
    this.removeOrHideOriginalListSectionContent();
    this.buildLayout();
    this.bindEvents();
    WMInfiniteSlider.emitEvent(':afterInit', { el: this.el }, this.el);
  }

  addDataAttribute() {
    this.el.setAttribute('data-wm-plugin', this.pluginName);
  }

  extractData() {
    const container = this.el.querySelector('.user-items-list-item-container');
    if (!container || !container.dataset.currentContext) {
      console.error(`[${this.pluginName}] No data-current-context found`);
      return;
    }
    
    const contextData = JSON.parse(container.dataset.currentContext);
    this.originalContainer = container;
    this.data = contextData.userItems || [];
    this.options = contextData.options || {};
    this.styles = contextData.styles || {};
    this.sectionTitle = contextData.sectionTitle || null;
    this.sectionButton = contextData.sectionButton || null;
  }

  removeOrHideOriginalListSectionContent() {
    if (!this.originalContainer) return;
    
    // Get section title and button elements
    const sectionTitle = this.el.querySelector('.list-section-title');
    const sectionButton = this.el.querySelector('.list-section-button-container');
    
    if (this.isBackend) {
      this.originalContainer.style.display = 'none';
      if (sectionTitle) sectionTitle.style.display = 'none';
      if (sectionButton) sectionButton.style.display = 'none';
    } else {
      this.originalContainer.remove();
      if (sectionTitle) sectionTitle.remove();
      if (sectionButton) sectionButton.remove();
    }
  }

  buildLayout() {
    const userItemsList = this.el.querySelector('.user-items-list');
    const customContent = document.createElement('div');
    customContent.className = 'wm-plugin-content';
    
    // Create slider wrapper
    const sliderWrapper = document.createElement('div');
    sliderWrapper.className = 'infinite-slider-wrapper';
    
    // Create slider track
    const sliderTrack = document.createElement('div');
    sliderTrack.className = 'infinite-slider-track';
    
    // Apply reverse direction if enabled
    if (this.settings.reverse) {
      sliderTrack.dataset.reverse = 'true';
    }
    
    // Build initial slides
    this.data.forEach((item, index) => {
      if (item.image) {
        const slide = this.buildSlide(item, index);
        sliderTrack.appendChild(slide);
      }
    });
    
    sliderWrapper.appendChild(sliderTrack);
    customContent.appendChild(sliderWrapper);
    userItemsList.appendChild(customContent);
    
    // Wait for images to load before duplicating
    this.waitForImages(sliderTrack).then(() => {
      this.imagesLoaded = true;
      this.duplicateSlides(sliderTrack);
      this.calculateAnimation(sliderTrack);
    });
  }

  buildSlide(item, index) {
    const slide = document.createElement('div');
    slide.className = 'infinite-slider-item';
    slide.dataset.index = index;
    
    // Determine if this item should be clickable
    const hasLink = this.settings.allowClickthrough && item.button && item.button.buttonLink;
    
    // Create wrapper (either <a> or <div>)
    let imageWrapper;
    if (hasLink) {
      imageWrapper = document.createElement('a');
      imageWrapper.href = item.button.buttonLink;
      imageWrapper.className = 'infinite-slider-image';
      
      if (this.settings.clickthroughNewWindow) {
        imageWrapper.target = '_blank';
        imageWrapper.rel = 'noopener noreferrer';
      }
    } else {
      imageWrapper = document.createElement('div');
      imageWrapper.className = 'infinite-slider-image';
    }
    
    const img = document.createElement('img');
    img.src = item.image.assetUrl;
    img.alt = item.title || '';
    img.loading = 'eager'; // Load immediately for accurate measurements
    
    // Set focal point if available
    if (item.image.mediaFocalPoint) {
      const { x, y } = item.image.mediaFocalPoint;
      img.style.objectPosition = `${x * 100}% ${y * 100}%`;
    }
    
    imageWrapper.appendChild(img);
    slide.appendChild(imageWrapper);
    
    return slide;
  }

  waitForImages(container) {
    const images = Array.from(container.querySelectorAll('img'));
    
    const imagePromises = images.map(img => {
      if (img.complete && img.naturalHeight !== 0) {
        return Promise.resolve();
      }
      return new Promise(resolve => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    });
    
    return Promise.all(imagePromises);
  }

  duplicateSlides(sliderTrack) {
    const originalSlides = Array.from(sliderTrack.children);
    sliderTrack.dataset.originalCount = originalSlides.length;
    
    // Calculate how many duplications we need
    const viewportWidth = window.innerWidth;
    const trackWidth = sliderTrack.scrollWidth;

    // Loop guard: If the track is hidden (width 0), defer duplication until it's visible
    if (trackWidth === 0) {
      const attempts = parseInt(sliderTrack.dataset.duplicationAttempts || '0', 10);
      if (attempts > 100) {
        console.warn(`[${this.pluginName}] Unable to measure slider track width after multiple attempts.`);
        return;
      }
      sliderTrack.dataset.duplicationAttempts = attempts + 1;
      requestAnimationFrame(() => this.duplicateSlides(sliderTrack));
      return;
    }
    delete sliderTrack.dataset.duplicationAttempts;
    
    // Ensure at least 3x viewport coverage for seamless loop
    const duplications = Math.max(2, Math.ceil((viewportWidth * 3) / trackWidth));
    
    for (let i = 0; i < duplications; i++) {
      originalSlides.forEach(slide => {
        const clone = slide.cloneNode(true);
        clone.classList.add('cloned');
        sliderTrack.appendChild(clone);
      });
    }
  }

  calculateAnimation(sliderTrack) {
    // Force reflow for accurate measurements
    sliderTrack.offsetHeight;
    
    const originalSlides = Array.from(sliderTrack.children).filter(s => !s.classList.contains('cloned'));
    const gap = parseFloat(getComputedStyle(sliderTrack).gap || 0);
    
    // Calculate the width of one set of original slides
    let scrollDistance = 0;
    originalSlides.forEach(slide => {
      scrollDistance += slide.offsetWidth;
    });
    scrollDistance += gap * originalSlides.length;
    
    // Loop guard: Ensure we have a valid scroll distance
    if (scrollDistance === 0) {
      console.warn(`[${this.pluginName}] Cannot calculate animation with zero scroll distance.`);
      return;
    }
    
    // Determine speed based on viewport (settings control calculation logic only)
    const isMobile = window.innerWidth < 768;
    const speed = isMobile ? this.settings.speedMobile : this.settings.speedDesktop;
    
    // Calculate duration (distance / speed)
    const duration = scrollDistance / speed;
    
    // ONLY set runtime-calculated values that can't be predetermined
    // These are computed measurements, not styling preferences
    this.el.style.setProperty('--scroll-distance', `-${scrollDistance}px`);
    this.el.style.setProperty('--scroll-duration', `${duration}s`);
    
    // Mark as initialized
    sliderTrack.dataset.initialized = 'true';
  }

  resetSlider() {
    if (!this.imagesLoaded) return;
    
    const sliderTrack = this.el.querySelector('.infinite-slider-track');
    if (!sliderTrack || !sliderTrack.dataset.initialized) return;
    
    // Remove clones
    const clones = sliderTrack.querySelectorAll('.cloned');
    clones.forEach(clone => clone.remove());
    
    // Remove initialized flag
    delete sliderTrack.dataset.initialized;
    
    // Recalculate
    this.duplicateSlides(sliderTrack);
    this.calculateAnimation(sliderTrack);
  }

  bindEvents() {
    // Debounced resize handler
    window.addEventListener('resize', () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.resetSlider();
      }, 250);
    });
    
    // Pause on hover - only if stopOnHover is enabled
    if (this.settings.stopOnHover) {
      const sliderWrapper = this.el.querySelector('.infinite-slider-wrapper');
      if (sliderWrapper) {
        sliderWrapper.addEventListener('mouseenter', () => {
          this.el.classList.add('paused');
        });
        
        sliderWrapper.addEventListener('mouseleave', () => {
          this.el.classList.remove('paused');
        });
      }
    }
  }

  destroy() {
    // Remove custom content
    const customContent = this.el.querySelector('.wm-plugin-content');
    if (customContent) customContent.remove();
    
    // Restore original container
    if (this.originalContainer) {
      this.originalContainer.style.display = '';
    }
    
    // Restore section title and button
    const sectionTitle = this.el.querySelector('.list-section-title');
    const sectionButton = this.el.querySelector('.list-section-button-container');
    if (sectionTitle) sectionTitle.style.display = '';
    if (sectionButton) sectionButton.style.display = '';
    
    // Remove data attribute
    this.el.removeAttribute('data-wm-plugin');
    
    // Clear timers
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
    }
    
    // Emit destroy event
    WMInfiniteSlider.emitEvent(':destroy', { el: this.el }, this.el);
  }
}

// Immediate initialization (no DOMContentLoaded)
(function() {
  const pluginName = 'infinite-slider';
  const sections = document.querySelectorAll(`[id^="${pluginName}"]`);
  const instances = [];
  
  sections.forEach(section => {
    const sectionId = section.id;
    const settings = window.wmInfiniteSliderSettings?.[sectionId] || {};
    const instance = new WMInfiniteSlider(section, settings);
    instances.push(instance);
  });

  // Backend teardown: watch for edit mode activation
  if (window.top !== window.self) {
    const observer = new MutationObserver(() => {
      if (document.body.classList.contains('sqs-edit-mode-active')) {
        instances.forEach(instance => {
          if (instance && typeof instance.destroy === 'function') {
            instance.destroy();
          }
        });
        observer.disconnect();
      }
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });
  }
})();

