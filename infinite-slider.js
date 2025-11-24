/**
 * Infinite Slider Plugin for Squarespace List Sections
 * Copyright Will-Myers.com
 *
 * Transforms a list section into an infinitely scrolling image slider
 * with configurable height, speed, and aspect ratio
 **/

class WMInfiniteSlider {
  static pluginName = "infinite-slider";
  static sharedCursor = null; // Singleton custom cursor
  static cursorInstances = new Set(); // Track instances using the cursor

  static emitEvent(type, detail = {}, elem = document) {
    elem.dispatchEvent(new CustomEvent(`wm-${this.pluginName}${type}`, {detail, bubbles: true}));
  }

  constructor(el, settings = {}) {
    this.el = el; // The .page-section element
    this.settings = {
      speedMobile: 30, // pixels per second - used for duration calculation
      speedDesktop: 50, // pixels per second - used for duration calculation
      reverse: false, // reverse animation direction
      stopOnHover: false, // pause animation on hover
      allowClickthrough: false, // allow clicking items to navigate to their button link
      iconHtml:
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>', // HTML for clickthrough icon
      customCursor: false, // enable custom cursor with item title
      cursorTheme: null, // custom theme for cursor (defaults to section theme)
      preserveStructure: false, // preserve original list section HTML structure
      ...settings,
    };
    this.data = null;
    this.sectionTitle = null;
    this.sectionButton = null;
    this.options = null;
    this.styles = null;
    this.originalContainer = null; // Original container (source of truth, hidden)
    this.pluginContainer = null; // Duplicate container (where slider lives)
    this.originalSlides = []; // Store original slide elements for preserve mode
    this.pluginName = this.constructor.pluginName;
    this.isBackend = window.top !== window.self;
    this.resizeTimer = null;
    this.imagesLoaded = false;
    this.customCursorEl = null; // Reference to shared cursor (if enabled)
    this._cursorHandlers = null; // Store cursor event handlers for cleanup

    this.init();
  }

  init() {
    WMInfiniteSlider.emitEvent(":beforeInit", {el: this.el}, this.el);
    this.addDataAttribute();
    this.extractData();

    if (!this.data || this.data.length === 0) {
      console.warn(`[${this.pluginName}] No items found`);
      return;
    }

    this.removeOrHideOriginalListSectionContent();
    this.buildLayout();
    this.bindEvents();
    WMInfiniteSlider.emitEvent(":afterInit", {el: this.el}, this.el);
  }

  addDataAttribute() {
    this.el.setAttribute("data-wm-plugin", this.pluginName);
    
    // Add clickthrough data attribute if enabled
    if (this.settings.allowClickthrough) {
      this.el.setAttribute("data-allow-clickthrough", "true");
    }
  }

  extractData() {
    const container = this.el.querySelector(".user-items-list-item-container");
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

    // If preserving structure, capture original slide elements before they're removed
    if (this.settings.preserveStructure) {
      const slideSelector = ".list-item";
      const slides = container.querySelectorAll(slideSelector);

      this.originalSlides = Array.from(slides);
    }
  }

  removeOrHideOriginalListSectionContent() {
    if (!this.originalContainer) return;

    // Get section title and button elements
    const sectionTitle = this.el.querySelector(".list-section-title");
    const sectionButton = this.el.querySelector(".list-section-button-container");

    // Hide or remove section title and button
    if (this.isBackend) {
      if (sectionTitle) sectionTitle.style.display = "none";
      if (sectionButton) sectionButton.style.display = "none";
    } else {
      if (sectionTitle) sectionTitle.remove();
      if (sectionButton) sectionButton.remove();
    }

    // Create duplicate container for the plugin (Squarespace won't touch this one)
    this.pluginContainer = this.originalContainer.cloneNode(false); // Shallow clone (no children)
    
    // Remove Squarespace controller attributes so it doesn't get manipulated
    this.pluginContainer.removeAttribute("data-controller");
    this.pluginContainer.removeAttribute("data-controllers-bound");
    
    // Add identifier class for our plugin container
    this.pluginContainer.classList.add("wm-plugin-container");
    
    // Insert duplicate as sibling after the original
    this.originalContainer.insertAdjacentElement("afterend", this.pluginContainer);
    
    // Hide the original container (source of truth)
    this.originalContainer.style.display = "none";
  }

  buildLayout() {
    if (!this.pluginContainer) return;

    const customContent = document.createElement("div");
    customContent.className = "wm-plugin-content";

    // Create slider wrapper
    const sliderWrapper = document.createElement("div");
    sliderWrapper.className = "infinite-slider-wrapper";

    // Create slider track (ul for Squarespace consistency)
    const sliderTrack = document.createElement("ul");
    sliderTrack.className = "infinite-slider-track";

    // Apply reverse direction if enabled
    if (this.settings.reverse) {
      sliderTrack.dataset.reverse = "true";
    }

    // Build initial slides - use preserved structure or build from scratch
    if (this.settings.preserveStructure && this.originalSlides.length > 0) {
      this.el.dataset.preserveStructure = "true";

      // Set system gap from spaceBetweenSlides if available
      if (this.options.spaceBetweenSlides) {
        const gapValue = this.options.spaceBetweenSlides.value || 20;
        const gapUnit = this.options.spaceBetweenSlides.unit || "px";
        this.el.style.setProperty("--system-slider-gap", `${gapValue}${gapUnit}`);
      }

      if (this.options.minSlideHeight) {
        const minSlideHeightValue = this.options.minSlideHeight.value || 75;
        const minSlideHeightUnit = this.options.minSlideHeight.unit || "vh";
        this.el.style.setProperty("--system-min-slide-height", `${minSlideHeightValue}${minSlideHeightUnit}`);
      }

      // Set system width from maxColumns if available
      if (this.options.maxColumns) {
        const maxColumns = this.options.maxColumns;
        // Calculate width as: min(var(--sqs-site-max-width), 100vw) / maxColumns
        this.el.style.setProperty("--system-item-width", `calc(min(var(--sqs-site-max-width, 1920px), 100vw) / ${maxColumns})`);
      }

      this.originalSlides.forEach((originalSlide, index) => {
        const slide = this.cloneOriginalSlide(originalSlide, index);
        sliderTrack.appendChild(slide);
      });
    } else {
      this.data.forEach((item, index) => {
        if (item.image) {
          const slide = this.buildSlide(item, index);
          sliderTrack.appendChild(slide);
        }
      });
    }

    sliderWrapper.appendChild(sliderTrack);
    customContent.appendChild(sliderWrapper);
    this.pluginContainer.appendChild(customContent);

    // Create custom cursor if enabled (desktop only)
    if (this.settings.customCursor && window.innerWidth >= 768) {
      this.createCustomCursor();
    }

    // Wait for images to load before duplicating
    this.waitForImages(sliderTrack).then(() => {
      this.imagesLoaded = true;
      this.duplicateSlides(sliderTrack);
      this.calculateAnimation(sliderTrack);
    });
  }

  buildSlide(item, index) {
    const slide = document.createElement("li");
    slide.className = "infinite-slider-item";
    slide.dataset.index = index;

    // Determine if this item should be clickable
    const hasLink = this.settings.allowClickthrough && item.button && item.button.buttonLink;

    // Create wrapper (either <a> or <div>)
    let imageWrapper;
    if (hasLink) {
      imageWrapper = document.createElement("a");
      imageWrapper.href = item.button.buttonLink;
      imageWrapper.className = "infinite-slider-image";

      if (item.button.buttonNewWindow) {
        imageWrapper.target = "_blank";
        imageWrapper.rel = "noopener noreferrer";
      }
    } else {
      imageWrapper = document.createElement("div");
      imageWrapper.className = "infinite-slider-image";
    }

    const img = document.createElement("img");
    img.src = item.image.assetUrl;
    img.alt = item.title || "";
    img.loading = "eager"; // Load immediately for accurate measurements

    // Set focal point if available
    if (item.image.mediaFocalPoint) {
      const {x, y} = item.image.mediaFocalPoint;
      img.style.objectPosition = `${x * 100}% ${y * 100}%`;
    }

    imageWrapper.appendChild(img);
    slide.appendChild(imageWrapper);

    return slide;
  }

  cloneOriginalSlide(originalSlide, index) {
    // Deep clone the original slide element
    const slide = originalSlide.cloneNode(true);

    // Sanitize the cloned slide
    this.sanitizeClonedSlide(slide);

    // Add our plugin class
    slide.classList.add("infinite-slider-item");

    // Add index for cursor tracking
    slide.dataset.index = index;

    // Add clickthrough behavior for preserved mode
    if (this.settings.allowClickthrough) {
      const itemData = this.data[index];
      const buttonLink = itemData?.button?.buttonLink;
      
      if (buttonLink) {
        slide.style.cursor = "pointer";
        slide.addEventListener("click", (e) => {
          // Don't intercept clicks on existing links
          if (e.target.closest("a")) return;
          
          if (itemData.button.buttonNewWindow) {
            window.open(buttonLink, "_blank", "noopener,noreferrer");
          } else {
            window.location.href = buttonLink;
          }
        });
      }
    }

    // Wrap in <li> if the original isn't already an li (for ul consistency)
    if (slide.tagName.toLowerCase() !== 'li') {
      const li = document.createElement('li');
      li.className = 'infinite-slider-item-wrapper';
      li.appendChild(slide);
      li.dataset.index = index;
      return li;
    }

    return slide;
  }

  sanitizeClonedSlide(slide) {
    // Central location for cleaning/standardizing cloned HTML
    // Remove transform from inline styles (but preserve other styles)
    if (slide.style.transform) {
      slide.style.transform = "";
    }

    // Remove aria-hidden attribute
    slide.removeAttribute("aria-hidden");

    // Find and clean nested elements with transforms
    const elementsWithTransform = slide.querySelectorAll('[style*="transform"]');
    elementsWithTransform.forEach(el => {
      if (el.style.transform) {
        el.style.transform = "";
      }
    });

    // Load images immediately (change data-load to true or convert data-src to src)
    const images = slide.querySelectorAll("img[data-src]");
    images.forEach(img => {
      if (img.dataset.src && !img.src) {
        img.src = img.dataset.src;
      }
      img.setAttribute("data-load", "true");
      img.loading = "eager";
    });

    // Remove any animation attributes that might conflict
    slide.removeAttribute("data-animation-role");
    const animatedElements = slide.querySelectorAll("[data-animation-role]");
    animatedElements.forEach(el => {
      el.removeAttribute("data-animation-role");
    });
  }

  waitForImages(container) {
    const images = Array.from(container.querySelectorAll("img"));

    const imagePromises = images.map(img => {
      if (img.complete && img.naturalHeight !== 0) {
        return Promise.resolve();
      }
      return new Promise(resolve => {
        img.addEventListener("load", resolve, {once: true});
        img.addEventListener("error", resolve, {once: true});
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
      const attempts = parseInt(sliderTrack.dataset.duplicationAttempts || "0", 10);
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
        clone.classList.add("cloned");
        sliderTrack.appendChild(clone);
      });
    }
  }

  calculateAnimation(sliderTrack) {
    // Force reflow for accurate measurements
    sliderTrack.offsetHeight;

    const originalSlides = Array.from(sliderTrack.children).filter(s => !s.classList.contains("cloned"));
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
    this.el.style.setProperty("--scroll-distance", `-${scrollDistance}px`);
    this.el.style.setProperty("--scroll-duration", `${duration}s`);

    // Mark as initialized
    sliderTrack.dataset.initialized = "true";
  }

  resetSlider() {
    if (!this.imagesLoaded) return;

    const sliderTrack = this.el.querySelector(".infinite-slider-track");
    if (!sliderTrack || !sliderTrack.dataset.initialized) return;

    // Clear all slides (both original and clones)
    sliderTrack.innerHTML = "";
    
    // Rebuild slides from source of truth
    if (this.settings.preserveStructure && this.originalSlides.length > 0) {
      this.originalSlides.forEach((originalSlide, index) => {
        const slide = this.cloneOriginalSlide(originalSlide, index);
        sliderTrack.appendChild(slide);
      });
    } else {
      this.data.forEach((item, index) => {
        if (item.image) {
          const slide = this.buildSlide(item, index);
          sliderTrack.appendChild(slide);
        }
      });
    }

    // Remove initialized flag
    delete sliderTrack.dataset.initialized;

    // Recalculate
    this.duplicateSlides(sliderTrack);
    this.calculateAnimation(sliderTrack);
  }

  createCustomCursor() {
    const sliderWrapper = this.el.querySelector(".infinite-slider-wrapper");
    if (!sliderWrapper) return;

    // Use or create singleton cursor
    if (!WMInfiniteSlider.sharedCursor) {
      // Get theme from settings or section
      const theme = this.settings.cursorTheme || this.el.getAttribute("data-section-theme") || "";
      WMInfiniteSlider.initSharedCursor(theme);
    }

    // Register this instance
    WMInfiniteSlider.cursorInstances.add(this);
    this.customCursorEl = WMInfiniteSlider.sharedCursor.element;

    // Track mouse movement for this slider
    const mouseMoveHandler = e => {
      WMInfiniteSlider.sharedCursor.targetX = e.clientX;
      WMInfiniteSlider.sharedCursor.targetY = e.clientY;

      const item = e.target.closest(".infinite-slider-item");
      const textSpan = this.customCursorEl.querySelector(".infinite-slider-cursor-text");
      const iconSpan = this.customCursorEl.querySelector(".infinite-slider-cursor-icon");

      if (item) {
        const index = parseInt(item.dataset.index, 10);
        let title = "";
        let hasLink = false;

        if (this.settings.preserveStructure) {
          // Extract title from preserved HTML structure
          const titleElement = item.querySelector(".list-item-content__title, .user-items-list-carousel__media-link, h1, h2, h3, h4");
          if (titleElement) {
            title = titleElement.textContent.trim();
          }

          // Check if preserved structure has a link
          hasLink = !!item.querySelector("a[href]");
        } else {
          // Use data from JSON
          const itemData = this.data[index];
          if (itemData) {
            title = itemData.title || "";
            hasLink = this.settings.allowClickthrough && itemData.button && itemData.button.buttonLink;
          }
        }

        if (title) {
          textSpan.textContent = title;
          this.customCursorEl.classList.add("active");

          // Show icon if item has link
          if (hasLink) {
            iconSpan.innerHTML = this.settings.iconHtml;
            iconSpan.style.display = "";
          } else {
            iconSpan.style.display = "none";
          }
        }
      } else {
        this.customCursorEl.classList.remove("active");
        iconSpan.style.display = "none";
      }
    };

    const mouseLeaveHandler = () => {
      this.customCursorEl.classList.remove("active");
      const iconSpan = this.customCursorEl.querySelector(".infinite-slider-cursor-icon");
      if (iconSpan) iconSpan.style.display = "none";
    };

    sliderWrapper.addEventListener("mousemove", mouseMoveHandler);
    sliderWrapper.addEventListener("mouseleave", mouseLeaveHandler);

    // Store handlers for cleanup
    this._cursorHandlers = {mouseMoveHandler, mouseLeaveHandler, sliderWrapper};
  }

  static initSharedCursor(theme = "") {
    // Create cursor element
    const element = document.createElement("div");
    element.className = "infinite-slider-custom-cursor";

    // Apply theme attribute
    if (theme) {
      element.setAttribute("data-section-theme", theme);
    }

    // Create text span
    const textSpan = document.createElement("span");
    textSpan.className = "infinite-slider-cursor-text";
    element.appendChild(textSpan);

    // Create icon span (hidden by default)
    const iconSpan = document.createElement("span");
    iconSpan.className = "infinite-slider-cursor-icon";
    element.appendChild(iconSpan);

    document.querySelector("#siteWrapper").appendChild(element);

    // Initialize position at left edge, halfway down screen
    const initialX = 0;
    const initialY = window.innerHeight / 2;

    // Store shared cursor state first
    WMInfiniteSlider.sharedCursor = {
      element,
      targetX: initialX,
      targetY: initialY,
      currentX: initialX,
      currentY: initialY,
      rafId: null,
    };

    // Smooth interpolation function (linear interpolation)
    const lerp = (start, end, factor) => start + (end - start) * factor;

    // Animation loop for smooth cursor following using RAF
    const animate = () => {
      const cursor = WMInfiniteSlider.sharedCursor;

      // Safety check - stop if cursor was destroyed
      if (!cursor) return;

      // Interpolate current position towards target (0.05 = lag factor)
      cursor.currentX = lerp(cursor.currentX, cursor.targetX, 0.1);
      cursor.currentY = lerp(cursor.currentY, cursor.targetY, 0.1);

      // Default offsets (bottom-right of cursor)
      let offsetX = 30;
      const offsetY = 20;

      // Check if cursor would flow off right edge
      const elementWidth = element.offsetWidth;
      const viewportWidth = window.innerWidth;
      if (cursor.currentX + offsetX + elementWidth > viewportWidth) {
        // Switch to left side of cursor (keep same vertical offset)
        offsetX = -elementWidth - 10;
      }

      // Update position using transform for better performance
      element.style.transform = `translate(${cursor.currentX + offsetX}px, ${cursor.currentY + offsetY}px)`;

      // Continue animation loop
      cursor.rafId = requestAnimationFrame(animate);
    };

    // Start animation loop
    WMInfiniteSlider.sharedCursor.rafId = requestAnimationFrame(animate);
  }

  bindEvents() {
    // Debounced resize handler
    window.addEventListener("resize", () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.resetSlider();
      }, 250);
    });

    // Pause on hover - only if stopOnHover is enabled
    if (this.settings.stopOnHover) {
      const sliderWrapper = this.el.querySelector(".infinite-slider-wrapper");
      if (sliderWrapper) {
        sliderWrapper.addEventListener("mouseenter", () => {
          this.el.classList.add("paused");
        });

        sliderWrapper.addEventListener("mouseleave", () => {
          this.el.classList.remove("paused");
        });
      }
    }
  }

  destroy() {
    // Remove custom content
    const customContent = this.el.querySelector(".wm-plugin-content");
    if (customContent) customContent.remove();

    // Clean up custom cursor handlers
    if (this._cursorHandlers) {
      const {mouseMoveHandler, mouseLeaveHandler, sliderWrapper} = this._cursorHandlers;
      sliderWrapper.removeEventListener("mousemove", mouseMoveHandler);
      sliderWrapper.removeEventListener("mouseleave", mouseLeaveHandler);
      this._cursorHandlers = null;
    }

    // Unregister from cursor instances
    WMInfiniteSlider.cursorInstances.delete(this);

    // Only destroy shared cursor if no instances are using it
    if (WMInfiniteSlider.cursorInstances.size === 0 && WMInfiniteSlider.sharedCursor) {
      cancelAnimationFrame(WMInfiniteSlider.sharedCursor.rafId);
      WMInfiniteSlider.sharedCursor.element.remove();
      WMInfiniteSlider.sharedCursor = null;
    }

    this.customCursorEl = null;

    // Remove the plugin container (duplicate)
    if (this.pluginContainer) {
      this.pluginContainer.remove();
      this.pluginContainer = null;
    }

    // Restore original container visibility
    if (this.originalContainer) {
      this.originalContainer.style.display = "";
    }

    // Restore section title and button
    const sectionTitle = this.el.querySelector(".list-section-title");
    const sectionButton = this.el.querySelector(".list-section-button-container");
    if (sectionTitle) sectionTitle.style.display = "";
    if (sectionButton) sectionButton.style.display = "";

    // Remove data attributes and custom properties
    this.el.removeAttribute("data-wm-plugin");
    this.el.removeAttribute("data-preserve-structure");
    this.el.removeAttribute("data-allow-clickthrough");
    this.el.style.removeProperty("--system-slider-gap");
    this.el.style.removeProperty("--system-item-width");
    this.el.style.removeProperty("--scroll-distance");
    this.el.style.removeProperty("--scroll-duration");

    // Clear timers
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
    }

    // Emit destroy event
    WMInfiniteSlider.emitEvent(":destroy", {el: this.el}, this.el);
  }
}

// Immediate initialization (no DOMContentLoaded)
(function () {
  const pluginName = "infinite-slider";
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
      if (document.body.classList.contains("sqs-edit-mode-active")) {
        instances.forEach(instance => {
          if (instance && typeof instance.destroy === "function") {
            instance.destroy();
          }
        });
        observer.disconnect();
      }
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }
})();
