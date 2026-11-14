-- ============================================================================
-- AI ADVERTISEMENT ROBOT - INITIAL SEED DATA
-- Mechatronics Engineering Final Year Project
-- Administrator Account: nttf.ttc.m3b.group1.project@gmail.com
-- Password: group_1@nttf
-- ============================================================================

-- 1. Insert Pre-Configured Administrator Account (PBKDF2 SHA-256 with 100,000 iterations)
INSERT OR REPLACE INTO admins (id, email, password_hash, salt, role, updated_at) VALUES
('admin_nttf_01', 'nttf.ttc.m3b.group1.project@gmail.com', '62c2f5d5065463bbd80c4f8fb45b1230932b52142cf0bf1e045f565b81bb47de', 'cff010e1adc068af906840353003ce1f', 'superadmin', CURRENT_TIMESTAMP);

-- 2. Insert Default 21 Product Categories
INSERT OR IGNORE INTO categories (id, name, slug, description, display_order) VALUES
('cat_01', 'Food & Beverage', 'food-beverage', 'Packaged food, culinary items, snacks, and beverages', 1),
('cat_02', 'College / Education', 'college-education', 'College programs, technical training, admissions, and academic courses', 2),
('cat_03', 'Computer / Laptop', 'computer-laptop', 'Laptops, workstations, PC accessories, and computing peripherals', 3),
('cat_04', 'Mobile / Smartphone', 'mobile-smartphone', 'Flagship smartphones, budget devices, tablets, and mobile gadgets', 4),
('cat_05', 'Electronics', 'electronics', 'Consumer electronics, microcontrollers, smart gadgets, and IoT hardware', 5),
('cat_06', 'Automobile', 'automobile', 'Two-wheelers, four-wheelers, EV mobility, and automotive spares', 6),
('cat_07', 'Hotel / Resort', 'hotel-resort', 'Hospitality suites, destination stays, and luxury resort packages', 7),
('cat_08', 'Restaurant / Cafe', 'restaurant-cafe', 'Fine dining, cafe specials, buffet offerings, and culinary experiences', 8),
('cat_09', 'Clothing / Fashion', 'clothing-fashion', 'Apparel, traditional wear, formal clothing, and fashion trends', 9),
('cat_10', 'Home Appliances', 'home-appliances', 'Smart appliances, air purifiers, refrigerators, and smart home tech', 10),
('cat_11', 'Healthcare / Pharmacy', 'healthcare-pharmacy', 'Wellness products, healthcare monitoring kits, and diagnostics', 11),
('cat_12', 'Fitness / Gym', 'fitness-gym', 'Gym memberships, sports equipment, supplements, and fitness gear', 12),
('cat_13', 'Salon / Beauty', 'salon-beauty', 'Personal grooming, hair styling, skincare, and beauty spa services', 13),
('cat_14', 'Retail / Shopping', 'retail-shopping', 'Supermarkets, department stores, retail discounts, and hypermarkets', 14),
('cat_15', 'Finance / Banking', 'finance-banking', 'Student loans, banking solutions, insurance, and investment accounts', 15),
('cat_16', 'Travel / Tourism', 'travel-tourism', 'Holiday itineraries, Kerala tourism, travel bookings, and stays', 16),
('cat_17', 'Real Estate', 'real-estate', 'Commercial spaces, campus housing, apartments, and land developments', 17),
('cat_18', 'Service / Repair', 'service-repair', 'Electronics servicing, mechatronic prototyping, and maintenance', 18),
('cat_19', 'Training / Coaching', 'training-coaching', 'GATE coaching, technical workshops, robotics training, and coding', 19),
('cat_20', 'Gaming / Entertainment', 'gaming-entertainment', 'Gaming consoles, e-sports arenas, VR experiences, and gaming gear', 20),
('cat_21', 'Other / Custom', 'other-custom', 'Custom products, event announcements, and specialized equipment', 21);

-- Default System Settings
INSERT OR IGNORE INTO system_settings (key, value, is_encrypted, description) VALUES
('grok_api_configured', 'false', 0, 'Indicates if a valid Grok API key is saved'),
('grok_active_model', 'grok-2-1212', 0, 'Currently active verified xAI Grok model ID'),
('grok_api_masked_key', '', 0, 'Masked key for UI display e.g. xai-••••••••••••abcd'),
('grok_last_tested_at', '', 0, 'ISO timestamp of last successful Grok API test'),
('grok_last_error', '', 0, 'Last API error message if test or generation failed'),
('stt_provider', 'google-cloud-stt', 0, 'Selected Speech-to-Text provider with Malayalam (ml-IN) support'),
('tts_provider', 'google-cloud-tts', 0, 'Selected Text-to-Speech provider with Malayalam (ml-IN) neural voice'),
('voice_assistant_enabled', 'true', 0, 'Global toggle for AI voice assistant interaction'),
('wake_word', 'Hey Robot', 0, 'Fixed wake word for acoustic activation'),
('timezone', 'Asia/Kolkata', 0, 'Official robot and scheduling timezone'),
('robot_operating_mode', 'MANUAL', 0, 'Current state: MANUAL, AUTONOMOUS, EMERGENCY_STOP'),
('emergency_stop_active', 'false', 0, 'Global emergency stop lock flag'),
('robot_device_id', 'ESP32_MAIN_ROBOT_01', 0, 'Authorized Main ESP32-S3 hardware identifier'),
('camera_device_id', 'ESP32_CAM_AI_01', 0, 'Authorized ESP32-S3 AI Camera identifier'),
('active_ad_id', 'ad_demo_01', 0, 'Currently active advertisement ID on DWIN HMI and Kiosk'),
('active_ad_page_id', '1', 0, 'DWIN HMI screen page ID (1-5) corresponding to active ad');

-- Default Authorized Devices
-- SHA-256 of default device pre-shared key 'SevenSemi_ESP32_Secret_2026'
INSERT OR IGNORE INTO devices (id, device_name, device_type, api_key_hash, firmware_version, status) VALUES
('ESP32_MAIN_ROBOT_01', 'SevenSemi Main Controller', 'MAIN_CONTROLLER', '35ac1c6dbdf39e504068593847525287f3484f932bf5a92a5d2b7e29bbef24b8', '1.0.0', 'offline'),
('ESP32_CAM_AI_01', 'ESP32-S3 AI Vision Camera', 'AI_CAMERA', '81b7e46247c4e51be58a0bb385f541be5e9d99723528b12f676046e7f828bb23', '1.0.0', 'offline');

-- Sample Initial Products (4-5 products ready for advertisements across categories)
INSERT OR IGNORE INTO products (id, name, category_id, brand, model, price, currency, description, description_ml, features_json, specs_json, promo_info, availability, faq_json, image_url) VALUES
('prod_01', 'NTTF Advanced Mechatronics Diploma', 'cat_02', 'NTTF TTC', 'M3B-2026', 75000, 'INR', 
 'Premier practical diploma in Mechatronics, Robotics, IoT and Embedded Systems Engineering. Hands-on laboratory training and industrial placement guarantee.',
 'മെക്കാട്രോണിക്‌സ്, റോബോട്ടിക്‌സ്, എംബഡഡ് സിസ്റ്റംസ് എന്നിവയിൽ പ്രായോഗിക ഡിപ്ലോമ കോഴ്‌സ്. 100% പ്ലേസ്‌മെന്റ് പിന്തുണ.',
 '["Hands-on Robotics Lab", "Industrial PLC & Automation", "AI & Embedded IoT", "100% Placement Assistance"]',
 '{"Duration": "3 Years", "Eligibility": "SSLC / Plus Two", "Location": "TTC Campus", "Batch": "2026 Admissions"}',
 'Early bird scholarship of ₹10,000 for top entrance rankers.',
 'Admissions Open',
 '[{"q": "What is the qualification required?", "a": "Pass in 10th Standard or Plus Two with Science/Maths."}, {"q": "Is placement guaranteed?", "a": "NTTF TTC maintains over 95% placement record in leading industries."}]',
 '/assets/ads/nttf_mechatronics.png'),

('prod_02', 'Titan X-Pro Gaming Laptop', 'cat_03', 'Titan Tech', 'TX-9000', 89999, 'INR',
 'Next-gen high-performance workstation featuring 16-Core Processor, RTX 4070 GPU, and 165Hz QHD Display.',
 'ശക്തമായ ഗ്രാഫിക്സും ഉയർന്ന പ്രകടനവുമുള്ള ഗെയിമിംഗ് ലാപ്ടോപ്പ്. വിദ്യാർത്ഥികൾക്ക് പ്രത്യേക കിഴിവ്.',
 '["Intel Core i9 14th Gen", "NVIDIA RTX 4070 8GB", "32GB DDR5 RAM", "1TB Gen4 NVMe SSD"]',
 '{"Screen": "16.1 inch QHD 165Hz", "Weight": "2.1 kg", "Battery": "80Wh Fast Charging"}',
 'Get Free RGB Mechanical Keyboard and Gaming Mouse worth ₹5,999!',
 'In Stock',
 '[{"q": "What is the warranty period?", "a": "2 years comprehensive onsite manufacturer warranty."}]',
 '/assets/ads/gaming_laptop.png'),

('prod_03', 'AeroPulse Smart Noise-Cancelling Headphones', 'cat_05', 'AeroAudio', 'AP-NC7', 12499, 'INR',
 'Active Noise Cancellation headphones with 45-hour battery life, studio acoustic drivers, and dual-microphone clarity.',
 'ക്രിസ്റ്റൽ ക്ലിയർ ശബ്ദവും 45 മണിക്കൂർ ബാറ്ററി ലൈഫും നൽകുന്ന ആധുനിക ഹെഡ്ഫോൺ.',
 '["Hybrid Active Noise Cancellation", "45-Hour Battery Life", "Bluetooth 5.3 Low Latency", "Ultra-soft Memory Foam Cushions"]',
 '{"Driver": "40mm Beryllium", "Weight": "240g", "Charging": "USB-C Quick Charge (10 min = 5 hrs)"}',
 'Flat 20% festive discount available this week.',
 'In Stock',
 '[{"q": "Does it have a microphone?", "a": "Yes, it features 4 beamforming microphones with ENC for clear calls."}]',
 '/assets/ads/smart_headphones.png'),

('prod_04', 'VoltRide Apex Electric Scooter', 'cat_06', 'VoltRide', 'Apex-EV', 115000, 'INR',
 'Next-generation smart electric two-wheeler with 140km true range, fast-charging battery, and integrated touchscreen navigation.',
 '140 കി.മീ മൈലേജും ഫാസ്റ്റ് ചാർജിംഗും ഉള്ള പുതിയ ഇലക്ട്രിക് സ്കൂട്ടർ.',
 '["140 km True Range", "0 to 40 km/h in 3.1s", "IP67 Waterproof Battery", "Keyless Smart App Access"]',
 '{"Battery": "3.7 kWh LiFePO4", "Top Speed": "85 km/h", "Charging Time": "3.5 hrs"}',
 'Complimentary 3-year roadside assistance & free home charger installation.',
 'Booking Open',
 '[{"q": "What is the battery warranty?", "a": "5 years or 60,000 km battery warranty."}]',
 '/assets/ads/electric_scooter.png'),

('prod_05', 'Campus Fresh Cafe Gourmet Combo', 'cat_08', 'Campus Cafe', 'Combo-Special', 199, 'INR',
 'Fresh artisan cappuccino paired with freshly baked cheesy croissant or signature burger. Perfect study treat.',
 'രുചികരമായ കോപ്പിയും ബർഗറും അടങ്ങിയ സ്പെഷ്യൽ കോംബോ ഓഫർ വെറും 199 രൂപയ്ക്ക്.',
 '["Fresh 100% Arabica Roast", "Artisan Baked Snack", "Served Hot & Fresh", "Dine-in or Takeaway"]',
 '{"Prep Time": "5-7 mins", "Dietary": "Veg / Non-Veg options available"}',
 'Special 15% student discount on presenting college ID card.',
 'Available Daily',
 '[{"q": "Is the student discount applicable all day?", "a": "Yes, student discount is valid Monday through Saturday."}]',
 '/assets/ads/cafe_combo.png');

-- Sample Initial Advertisements linked to the products (ready for automatic rotation)
INSERT OR IGNORE INTO advertisements (id, title, product_id, category_id, poster_url, short_desc, short_desc_ml, detailed_desc, price, features, promo_info, priority, status, display_page_id) VALUES
('ad_demo_01', 'NTTF Mechatronics Admissions 2026', 'prod_01', 'cat_02', '/assets/ads/nttf_mechatronics.png', 
 'Shape Your Engineering Future with NTTF TTC Mechatronics Diploma!', 
 'എൻ.ടി.ടി.എഫ് മെക്കാട്രോണിക്‌സ് ഡിപ്ലോമ അഡ്മിഷൻ ആരംഭിച്ചു!',
 'Join the industry-leading 3-Year Diploma in Mechatronics Engineering. Hands-on learning in Industrial Robotics, Embedded Systems, and AI-driven automation.', 
 75000, 'Robotics Lab • Industrial Automation • 100% Placement Support', '₹10,000 Early Bird Scholarship', 3, 'active', 1),

('ad_demo_02', 'Titan X-Pro RTX 4070 Gaming Laptop', 'prod_02', 'cat_03', '/assets/ads/gaming_laptop.png',
 'Unleash Maximum Power with Titan X-Pro RTX 4070 Workstation!',
 'ടൈറ്റൻ എക്സ്-പ്രോ ഹൈ പെർഫോമൻസ് ലാപ്ടോപ്പ് ഇപ്പോൾ ലഭ്യമാണ്!',
 'Equipped with 14th Gen Intel Core i9, 32GB DDR5 RAM, and RTX 4070 8GB Graphics. The ultimate tool for engineers, creators, and gamers.',
 89999, 'i9 14th Gen • RTX 4070 8GB • 32GB DDR5 • 165Hz QHD', 'Free Gaming Keyboard & Mouse Worth ₹5,999', 2, 'scheduled', 2),

('ad_demo_03', 'AeroPulse Hybrid ANC Headphones', 'prod_03', 'cat_05', '/assets/ads/smart_headphones.png',
 'Immerse Yourself in Pure Studio Sound with AeroPulse NC7',
 'ക്രിസ്റ്റൽ ക്ലിയർ സൗണ്ട് അനുഭവം നൽകുന്ന പുതിയ ഹെഡ്ഫോൺ',
 '45-hour battery life, active noise cancellation, and ergonomic memory-foam headband for all-day focus and crystal clear calls.',
 12499, 'Active Noise Cancellation • 45h Battery • Bluetooth 5.3', 'Flat 20% Instant Discount This Week', 1, 'scheduled', 3),

('ad_demo_04', 'VoltRide Apex Smart Electric Scooter', 'prod_04', 'cat_06', '/assets/ads/electric_scooter.png',
 'Ride the Green Revolution with VoltRide Apex 140km Range!',
 '140 കിലോമീറ്റർ മൈലേജ് നൽകുന്ന പുതിയ ഇലക്ട്രിക് സ്കൂട്ടർ',
 'Experience silent acceleration from 0-40 km/h in 3.1s with IP67 waterproof battery and connected navigation dashboard.',
 115000, '140 km Range • Fast Charging • 5-Year Battery Warranty', 'Free Home Charger Installation', 1, 'scheduled', 4),

('ad_demo_05', 'Campus Fresh Cafe Gourmet Combo', 'prod_05', 'cat_08', '/assets/ads/cafe_combo.png',
 'Fuel Your Day with Premium Roast Coffee & Artisan Croissant!',
 'കാമ്പസ് കഫേയിൽ നിന്ന് രുചികരമായ കോംബോ ഓഫറുകൾ',
 'Freshly brewed Arabica espresso paired with hot bakery delicacies. Ideal companion for your campus breaks.',
 199, '100% Arabica Beans • Baked Fresh • Quick Service', '15% Off with Student ID', 1, 'scheduled', 5);

-- Initial Schedule (Rotates Ads 1 to 5 every hour or automatically sequentially)
INSERT OR IGNORE INTO advertisement_schedules (id, advertisement_id, start_time, end_time, duration_sec, priority, is_active) VALUES
('sch_01', 'ad_demo_01', '2026-01-01 00:00:00', '2027-12-31 23:59:59', 30, 3, 1),
('sch_02', 'ad_demo_02', '2026-01-01 00:00:00', '2027-12-31 23:59:59', 30, 2, 1),
('sch_03', 'ad_demo_03', '2026-01-01 00:00:00', '2027-12-31 23:59:59', 30, 1, 1),
('sch_04', 'ad_demo_04', '2026-01-01 00:00:00', '2027-12-31 23:59:59', 30, 1, 1),
('sch_05', 'ad_demo_05', '2026-01-01 00:00:00', '2027-12-31 23:59:59', 30, 1, 1);
