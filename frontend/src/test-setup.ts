// Отключаем патч jasmine в zone.js — конфликтует с read-only глобалами
// (TypeError: Cannot assign to read only property 'describe').
// Флаги должны быть выставлены ДО импорта zone.js/zone.js/testing.
(window as any).__Zone_disable_jasmine_patch = true;
(window as any).__Zone_disable_zone_testing = true;

import 'zone.js';
import 'zone.js/testing';