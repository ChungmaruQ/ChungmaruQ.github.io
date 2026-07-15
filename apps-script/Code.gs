var DEFAULT_CONFIG = {
  displayName: "Prof. Your Name",
  calendarId: "primary",
  timeZone: "Asia/Seoul",
  showEventTitles: false,
  llm: {
    enabled: false,
    provider: "mindlogic",
    maxEvents: 3,
    dailyMaxEvents: 8
  },
  mindlogic: {
    baseUrl: "https://factchat-cloud.mindlogic.ai/v1/gateway",
    model: "gpt-5.4-mini"
  },
  openai: {
    enabled: false,
    model: "gpt-5.5"
  },
  officeHours: {
    mon: [["09:30", "12:00"], ["13:00", "18:00"]],
    tue: [["09:30", "12:00"], ["13:00", "18:00"]],
    wed: [["09:30", "12:00"], ["13:00", "18:00"]],
    thu: [["09:30", "12:00"], ["13:00", "18:00"]],
    fri: [["09:30", "12:00"], ["13:00", "18:00"]],
    sat: [],
    sun: []
  },
  lunchBreak: {
    enabled: true,
    start: "12:00",
    end: "13:00"
  },
  officeEventKeywords: ["office hour", "office hours", "오피스아워", "상담"],
  officeLocationKeywords: ["YOUR_OFFICE_ADDRESS_OR_ROOM_KEYWORD"],
  awayKeywords: ["ooo", "out of office", "부재", "휴가", "출장", "외부", "외부일정", "외부 일정", "한의학연구원"],
  titleStatusKeywords: {
    travel: ["출장", "외근", "외부", "외부일정", "외부 일정", "한의학연구원", "연구원 방문", "기관 방문", "business trip", "offsite", "external appointment"],
    leave: ["휴가", "연차", "반차", "vacation", "pto", "leave", "day off"],
    remote: ["remote", "재택", "원격", "wfh", "work from home"],
    lunch: ["lunch", "lunch break", "점심", "식사"],
    teaching: ["수업", "강의", "강좌", "실습", "class", "lecture", "teaching", "course"],
    meeting: ["회의", "미팅", "meeting", "mtg", "seminar", "세미나", "call"]
  }
};

var DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function refreshSenseCraftJson() {
  var config = getConfig_();
  var status = buildStatus_(config);
  var senseCraftJson = JSON.stringify(toSenseCraftStatus_(status, config), null, 2);
  publishSenseCraftToGitHub_(config, senseCraftJson);
  return senseCraftJson;
}

function installQuarterHourlyTrigger() {
  installSixHourlyTrigger();
}

function installHourlyTrigger() {
  installSixHourlyTrigger();
}

function installSixHourlyTrigger() {
  installRefreshTrigger_(360);
}

function installRefreshTrigger_(minutes) {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === "refreshSenseCraftJson") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  var builder = ScriptApp.newTrigger("refreshSenseCraftJson").timeBased();
  if (minutes >= 60 && minutes % 60 === 0) {
    builder.everyHours(minutes / 60).create();
  } else {
    builder.everyMinutes(minutes).create();
  }
}

function previewSenseCraftJson() {
  var config = getConfig_();
  var status = buildStatus_(config);
  Logger.log(JSON.stringify(toSenseCraftStatus_(status, config), null, 2));
}

function testLlmConnection() {
  var config = getConfig_();
  var now = new Date();
  var day = startOfLocalDay_(now);
  var input = {
    task: "daily_office_door_status_test",
    now: now.toISOString(),
    time_zone: config.timeZone,
    office_hours: officeHoursText_(config, now),
    has_office_hours_today: hasOfficeHoursOnDate_(config, now),
    presence: {
      office: false,
      campus: false,
      away: false
    },
    events: [{
      id: "test-external-visit",
      title: "한의학연구원 방문",
      location: "",
      event_type: "default",
      transparency: "opaque",
      all_day: true,
      start: day.toISOString(),
      end: addDays_(day, 1).toISOString()
    }]
  };
  var result = {
    llm_enabled: config.llm.enabled,
    provider: config.llm.provider,
    has_mindlogic_key: Boolean(config.mindlogic.apiKey),
    has_openai_key: Boolean(config.openai.apiKey),
    expected_day_status: "away"
  };

  if (!config.llm.enabled) {
    result.ok = false;
    result.error = "LLM_ENABLED is false.";
    Logger.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (config.llm.provider === "mindlogic") {
    result.response = testMindlogicDailyClassification_(config, input);
  } else if (config.llm.provider === "openai") {
    result.response = testOpenAiDailyClassification_(config, input);
  } else {
    result.response = { ok: false, error: "Unsupported LLM_PROVIDER." };
  }

  result.ok = Boolean(
    result.response &&
    result.response.ok &&
    result.response.classification &&
    result.response.classification.should_override &&
    result.response.classification.day_status === "away"
  );
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function listMindlogicModels() {
  var config = getConfig_();
  var result = {
    provider: config.llm.provider,
    has_mindlogic_key: Boolean(config.mindlogic.apiKey),
    base_url: trimTrailingSlash_(config.mindlogic.baseUrl)
  };
  if (!config.mindlogic.apiKey) {
    result.ok = false;
    result.error = "MINDLOGIC_API_KEY is missing.";
    Logger.log(JSON.stringify(result, null, 2));
    return result;
  }

  var response = UrlFetchApp.fetch(
    trimTrailingSlash_(config.mindlogic.baseUrl) + "/models",
    {
      method: "get",
      headers: {
        Authorization: "Bearer " + config.mindlogic.apiKey
      },
      muteHttpExceptions: true
    }
  );
  var code = response.getResponseCode();
  var text = response.getContentText() || "";
  result.ok = code >= 200 && code < 300;
  result.code = code;
  if (!result.ok) {
    result.error_preview = text.slice(0, 500);
  } else {
    var body = JSON.parse(text || "{}");
    result.models = (body.data || body.models || []).map(function(model) {
      return typeof model === "string" ? model : model.id || model.name || "";
    }).filter(Boolean);
    if (!result.models.length) {
      result.raw_preview = text.slice(0, 500);
    }
  }
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function debugTodayEvents() {
  var config = getConfig_();
  var now = new Date();
  var events = normalizeEvents_(fetchCalendarEvents_(config, now));
  var day = startOfLocalDay_(now);
  var status = computeStatus_(config, now, events, {
    demo: false,
    configured: true,
    authorized: true
  });
  var props = PropertiesService.getScriptProperties();

  Logger.log(JSON.stringify({
    calendar_id: config.calendarId,
    now: now.toISOString(),
    llm: {
      enabled: config.llm.enabled,
      provider: config.llm.provider,
      has_mindlogic_key: Boolean(config.mindlogic.apiKey),
      has_openai_key: Boolean(config.openai.apiKey)
    },
    geofence: {
      status: props.getProperty("GEOFENCE_STATUS") || "",
      updated_at: props.getProperty("GEOFENCE_UPDATED_AT") || "",
      office_exit_started_at: props.getProperty("GEOFENCE_OFFICE_EXIT_STARTED_AT") || ""
    },
    computed: {
      state: status.state,
      headline: status.headline,
      detail: status.detail,
      geofence_away: status.geofenceAway,
      geofence_campus: status.geofenceCampus,
      geofence_office: status.geofenceOffice,
      full_away_day: status.fullAwayDay,
      daily_llm_status: status.dailyLlmStatus || null,
      daily_llm_next_available_at: status.dailyLlmNextAvailableAt || "",
      away_days: status.awayDays
    },
    today_events: events.filter(function(event) {
      return eventOverlapsDay_(event, day);
    }).map(function(event) {
      var titleStatus = titleStatusForEvent_(config, event);
      return {
        title: event.summary || "",
        location: event.location || "",
        event_type: event.eventType || "",
        transparency: event.transparency || "",
        all_day: Boolean(event.allDay),
        start: event.start ? event.start.toISOString() : "",
        end: event.end ? event.end.toISOString() : "",
        title_status: titleStatus ? titleStatus.state : "",
        away_candidate: isAwayDayCandidate_(config, event),
        availability_blocker: isAvailabilityBlockerEvent_(config, event)
      };
    })
  }, null, 2));
}

function doPost(e) {
  var config = getConfig_();
  return handlePresenceWebhook_(config, parseRequestBody_(e));
}

function doGet(e) {
  var config = getConfig_();
  var params = e && e.parameter ? e.parameter : {};
  if (params.presence || params.status || params.latitude || params.longitude) {
    return handlePresenceWebhook_(config, params);
  }
  return jsonResponse_({ ok: true, service: "sensecraft-office-hours" });
}

function handlePresenceWebhook_(config, body) {
  if (!config.location.webhookSecret) {
    return jsonResponse_({
      ok: false,
      error: "LOCATION_WEBHOOK_SECRET is not configured."
    });
  }

  if (String(body.secret || "") !== config.location.webhookSecret) {
    return jsonResponse_({
      ok: false,
      error: "Unauthorized."
    });
  }

  var presence = String(body.presence || body.status || "").toLowerCase();
  var distanceKm = null;

  if (body.latitude !== undefined && body.longitude !== undefined) {
    var lat = Number(body.latitude);
    var lng = Number(body.longitude);
    if (!isFinite(lat) || !isFinite(lng)) {
      return jsonResponse_({ ok: false, error: "Invalid latitude or longitude." });
    }
    if (!isFinite(config.location.officeLat) || !isFinite(config.location.officeLng)) {
      return jsonResponse_({ ok: false, error: "OFFICE_LAT and OFFICE_LNG are required." });
    }
    distanceKm = distanceBetweenKm_(lat, lng, config.location.officeLat, config.location.officeLng);
    presence = distanceKm > config.location.radiusKm
      ? "away"
      : (presence === "campus" ? "campus" : "office");
  }

  if (presence !== "away" && presence !== "office" && presence !== "campus") {
    return jsonResponse_({
      ok: false,
      error: "Use presence/status 'office', 'campus', or 'away', or send latitude/longitude."
    });
  }

  var props = PropertiesService.getScriptProperties();
  var nowIso = new Date().toISOString();
  var previousPresence = String(props.getProperty("GEOFENCE_STATUS") || "").toLowerCase();
  var previousExitStartedAt = props.getProperty("GEOFENCE_OFFICE_EXIT_STARTED_AT") || "";
  var officeExitStartedAt = "";

  if (presence === "office") {
    officeExitStartedAt = "";
  } else if (presence === "campus") {
    officeExitStartedAt = previousPresence === "office"
      ? nowIso
      : previousPresence === "campus"
      ? previousExitStartedAt
      : "";
  }

  props.setProperties({
    GEOFENCE_STATUS: presence,
    GEOFENCE_UPDATED_AT: nowIso,
    GEOFENCE_DISTANCE_KM: distanceKm === null ? "" : String(Math.round(distanceKm * 10) / 10),
    GEOFENCE_OFFICE_EXIT_STARTED_AT: officeExitStartedAt
  });

  var shouldPublish = String(body.publish === undefined ? "false" : body.publish).toLowerCase() === "true";
  var published = false;
  var publishError = "";
  if (shouldPublish) {
    try {
      refreshSenseCraftJson();
      published = true;
    } catch (error) {
      publishError = error.message;
    }
  }

  return jsonResponse_({
    ok: !publishError,
    presence: presence,
    distance_km: distanceKm === null ? "" : Math.round(distanceKm * 10) / 10,
    office_exit_grace_until: officeExitStartedAt
      ? addMinutes_(new Date(officeExitStartedAt), config.location.officeExitGraceMinutes).toISOString()
      : "",
    published: published,
    publish_error: publishError,
    updated_at: nowIso
  });
}

function buildStatus_(config) {
  var now = new Date();
  var events = fetchCalendarEvents_(config, now);
  return computeStatus_(config, now, normalizeEvents_(events), {
    demo: false,
    configured: true,
    authorized: true
  });
}

function fetchCalendarEvents_(config, now) {
  var timeMin = startOfLocalWeekMonday_(now);
  var timeMax = addDays_(startOfLocalDay_(now), 8);
  var calendarId = config.calendarId || "primary";
  var calendar = calendarId === "primary"
    ? CalendarApp.getDefaultCalendar()
    : CalendarApp.getCalendarById(calendarId);

  if (!calendar) {
    throw new Error("Calendar not found or not accessible: " + calendarId);
  }

  return calendar
    .getEvents(timeMin, timeMax)
    .slice(0, 50)
    .map(function(event) {
      return calendarAppEventToApiEvent_(config, event);
    });
}

function calendarAppEventToApiEvent_(config, event) {
  var start = safeCalendarCall_(event, "getStartTime", null);
  var end = safeCalendarCall_(event, "getEndTime", null);
  var allDay = Boolean(safeCalendarCall_(event, "isAllDayEvent", false));

  var item = {
    id: safeCalendarCall_(event, "getId", ""),
    summary: safeCalendarCall_(event, "getTitle", ""),
    location: safeCalendarCall_(event, "getLocation", ""),
    status: "confirmed",
    eventType: "default",
    transparency: calendarEventTransparency_(event)
  };

  if (allDay) {
    item.start = { date: formatDateOnly_(start, config) };
    item.end = { date: formatDateOnly_(calendarAllDayEnd_(event, start, end), config) };
  } else {
    item.start = { dateTime: start.toISOString() };
    item.end = { dateTime: end.toISOString() };
  }

  return item;
}

function safeCalendarCall_(event, methodName, fallback) {
  try {
    return typeof event[methodName] === "function" ? event[methodName]() : fallback;
  } catch (error) {
    return fallback;
  }
}

function calendarEventTransparency_(event) {
  var transparency = String(safeCalendarCall_(event, "getTransparency", "opaque")).toLowerCase();
  return transparency.indexOf("transparent") !== -1 ? "transparent" : "opaque";
}

function calendarAllDayEnd_(event, start, end) {
  var allDayEnd = safeCalendarCall_(event, "getAllDayEndDate", null);
  if (allDayEnd) {
    return allDayEnd;
  }
  if (end && start && end > start) {
    return end;
  }
  return addDays_(start, 1);
}

function formatDateOnly_(date, config) {
  return Utilities.formatDate(date, config.timeZone, "yyyy-MM-dd");
}

function normalizeEvents_(events) {
  return events
    .filter(function(event) {
      return event.status !== "cancelled";
    })
    .map(function(event) {
      var range = readEventRange_(event);
      return {
        id: event.id,
        summary: event.summary || "",
        location: event.location || "",
        eventType: event.eventType || "default",
        transparency: event.transparency || "opaque",
        start: range.start,
        end: range.end,
        allDay: range.allDay,
        workingLocationProperties: event.workingLocationProperties,
        outOfOfficeProperties: event.outOfOfficeProperties,
        focusTimeProperties: event.focusTimeProperties
      };
    })
    .filter(function(event) {
      return event.start && event.end;
    })
    .sort(function(a, b) {
      return a.start - b.start;
    });
}

function readEventRange_(event) {
  if (event.start && event.start.dateTime) {
    return {
      start: new Date(event.start.dateTime),
      end: new Date(event.end.dateTime),
      allDay: false
    };
  }

  if (event.start && event.start.date) {
    return {
      start: dateOnlyToLocalDate_(event.start.date),
      end: dateOnlyToLocalDate_(event.end.date),
      allDay: true
    };
  }

  return { start: null, end: null, allDay: false };
}

function dateOnlyToLocalDate_(value) {
  var parts = value.split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function computeStatus_(config, now, events, connection) {
  var currentEvents = events.filter(function(event) {
    return includesTime_(event, now);
  });
  var geofenceAway = isGeofenceAway_(config, now);
  var geofenceCampus = isGeofenceCampus_(config, now);
  var geofenceOffice = isGeofenceOffice_(config, now);
  var officeInfo = getOfficeInfo_(config, now, events);
  var currentAway = firstMatching_(currentEvents, function(event) {
    return isAwayEvent_(config, event);
  });
  var currentOffsite = firstMatching_(currentEvents, function(event) {
    return isOffsiteLocationEvent_(config, event);
  });
  var currentLlmStatus = null;
  var currentTitleStatus = firstTitleStatus_(config, currentEvents);
  var currentEffectiveTitleStatus = geofenceOffice && isOfficePresenceOverridableStatus_(currentTitleStatus)
    ? null
    : currentTitleStatus;
  var currentWorkingLocation = firstMatching_(currentEvents, isWorkingLocation_);
  var currentWorkingLocationInfo = currentWorkingLocation ? describeWorkingLocation_(currentWorkingLocation) : null;
  var currentBusy = firstMatching_(currentEvents, function(event) {
    return isBusyEvent_(event) &&
      !isOfficeEvent_(config, event) &&
      !(geofenceOffice && isOfficePresenceOverridableEvent_(config, event));
  });
  var currentLlmEvents = geofenceOffice
    ? currentEvents.filter(function(event) {
      return !isOfficePresenceOverridableEvent_(config, event);
    })
    : currentEvents;
  var hasOfficeHoursToday = hasOfficeHoursOnDate_(config, now);
  var currentLunch = hasOfficeHoursToday ? implicitLunchBreak_(config, now) : null;
  var nextAvailableAt = findNextAvailable_(
    config,
    geofenceAway ? addDays_(startOfLocalDay_(now), 1) : now,
    events
  );
  var currentWorkingElsewhere = currentWorkingLocationInfo && !currentWorkingLocationInfo.availableHere && !geofenceOffice;
  var nonOfficeDayWithoutOfficePresence = !hasOfficeHoursToday && !geofenceOffice;

  var state = "closed";
  var headline = "Office Hours Closed";
  var detail = "Visits are not available right now.";
  var currentUntil = officeInfo.nextWindow ? officeInfo.nextWindow.start : null;
  var availableByPresence = false;

  if (currentAway && !geofenceOffice) {
    state = "away";
    headline = "Out of Office";
    detail = currentAway.allDay ? "Out of office today." : "Out of office right now.";
    currentUntil = currentAway.end;
  } else if (currentOffsite && !geofenceOffice) {
    state = "offsite";
    headline = "Out of Office";
    detail = "Offsite appointment.";
    currentUntil = currentOffsite.end;
  } else if (nonOfficeDayWithoutOfficePresence) {
    state = "off_hours";
    headline = "Out of Office";
    detail = nextAvailableAt
      ? "Back " + formatSentenceDateTime_(nextAvailableAt, now, config) + "."
      : "Office hours are closed.";
    currentUntil = nextAvailableAt || null;
  } else if (currentEffectiveTitleStatus) {
    state = currentEffectiveTitleStatus.state;
    headline = currentEffectiveTitleStatus.headline;
    detail = currentEffectiveTitleStatus.detail;
    currentUntil = currentEffectiveTitleStatus.event.end;
  } else if (!config.dailyMode &&
      (currentLlmStatus = classifyCurrentStatusWithLlm_(config, now, currentLlmEvents)) &&
      !(geofenceOffice && isOfficePresenceOverridableStatus_(currentLlmStatus))) {
    state = currentLlmStatus.state;
    headline = currentLlmStatus.headline;
    detail = currentLlmStatus.detail;
    currentUntil = currentLlmStatus.currentUntil;
  } else if (currentWorkingElsewhere) {
    state = "remote";
    headline = "Out of Office";
    detail = "Out of office.";
    currentUntil = currentWorkingLocation.end;
  } else if (geofenceAway) {
    state = "offsite";
    headline = "Out of Office";
    detail = nextAvailableAt
      ? "Back " + formatSentenceDateTime_(nextAvailableAt, now, config) + "."
      : "Out of office today.";
    currentUntil = null;
  } else if (currentBusy) {
    state = "busy";
    headline = "Busy";
    detail = "Busy right now.";
    currentUntil = currentBusy.end;
  } else if (currentLunch) {
    state = "lunch";
    headline = "Lunch Break";
    detail = "Back at " + formatTime_(currentLunch.end, config) + ".";
    currentUntil = currentLunch.end;
  } else if (geofenceCampus) {
    state = "campus";
    headline = "On Campus";
    detail = "Back soon.";
    currentUntil = null;
  } else if (!officeInfo.isOpen) {
    if (geofenceOffice) {
      state = "available";
      headline = "Available";
      detail = "At the office.";
      currentUntil = null;
      availableByPresence = true;
    } else {
      state = "off_hours";
      headline = "Out of Office";
      detail = nextAvailableAt
        ? "Back " + formatSentenceDateTime_(nextAvailableAt, now, config) + "."
        : "Office hours are closed.";
      currentUntil = nextAvailableAt || null;
    }
  } else if (currentWorkingLocationInfo && geofenceOffice) {
    state = "available";
    headline = "At the Office";
    detail = currentWorkingLocationInfo.label;
    currentUntil = currentWorkingLocation.end;
  } else if (officeInfo.isOpen) {
    if (geofenceOffice) {
      state = "available";
      headline = "Available";
      detail = "At the office.";
      currentUntil = officeInfo.currentWindow ? officeInfo.currentWindow.end : null;
    } else {
      state = "offsite";
      headline = "Out of Office";
      detail = "Office presence not confirmed.";
      currentUntil = null;
    }
  }

  var agenda = events
    .filter(function(event) {
      return event.end > now;
    })
    .filter(function(event) {
      return !event.allDay;
    })
    .filter(function(event) {
      return event.start < addDays_(startOfLocalDay_(now), 1);
    })
    .filter(function(event) {
      return overlapsOfficeHours_(config, event);
    })
    .slice(0, 5)
    .map(function(event) {
      return presentAgendaEvent_(config, event);
    });
  var dailyAgenda = dailyAgendaEvents_(config, now, events).map(function(event) {
    return presentAgendaEvent_(config, event);
  });
  var dailyBestAfter = dailyBestAfter_(config, now, events);
  var dailyLlmStatus = config.dailyMode
    ? classifyDailyStatusWithLlm_(config, now, events, {
      geofenceAway: geofenceAway,
      geofenceCampus: geofenceCampus,
      geofenceOffice: geofenceOffice,
      hasOfficeHoursToday: hasOfficeHoursToday
    })
    : null;
  var dailyLlmNextAvailable = dailyLlmStatus && dailyLlmStatus.dayStatus === "away"
    ? findNextAvailable_(config, addDays_(startOfLocalDay_(now), 1), events)
    : null;

  return {
    connection: connection,
    displayName: config.displayName,
    generatedAt: new Date().toISOString(),
    now: now.toISOString(),
    state: state,
    headline: headline,
    detail: detail,
    currentUntil: currentUntil ? currentUntil.toISOString() : null,
    nextAvailableAt: nextAvailableAt ? nextAvailableAt.toISOString() : null,
    officeOpen: officeInfo.isOpen,
    availableByPresence: availableByPresence,
    geofenceAway: geofenceAway,
    geofenceCampus: geofenceCampus,
    geofenceOffice: geofenceOffice,
    hasOfficeHoursToday: hasOfficeHoursToday,
    fullAwayDay: dayHasFullAwayBlocker_(config, now, events),
    dailyLlmStatus: dailyLlmStatus,
    dailyLlmNextAvailableAt: dailyLlmNextAvailable ? dailyLlmNextAvailable.toISOString() : null,
    dailyBestAfterAt: dailyBestAfter ? dailyBestAfter.toISOString() : null,
    awayDays: weeklyAwayDays_(config, now, events),
    officeHoursText: officeHoursText_(config, now),
    agenda: agenda,
    dailyAgenda: dailyAgenda
  };
}

function firstMatching_(events, predicate) {
  return events.find(predicate) || null;
}

function includesTime_(event, date) {
  return event.start <= date && date < event.end;
}

function isAwayEvent_(config, event) {
  if (event.eventType === "outOfOffice") {
    return true;
  }
  return includesKeyword_(event.summary, config.awayKeywords || []);
}

function isWorkingLocation_(event) {
  return event.eventType === "workingLocation";
}

function implicitLunchBreak_(config, now) {
  var lunchBreak = config.lunchBreak || {};
  if (lunchBreak.enabled === false) {
    return null;
  }

  return implicitTimeWindow_(now, lunchBreak.start || "12:00", lunchBreak.end || "13:00");
}

function implicitTimeWindow_(now, startValue, endValue) {
  var start = timeOnDate_(now, startValue);
  var end = timeOnDate_(now, endValue);
  if (!(start < end)) {
    return null;
  }
  return start <= now && now < end ? { start: start, end: end } : null;
}

function isOfficeEvent_(config, event) {
  return includesKeyword_(event.summary, config.officeEventKeywords || []);
}

function isOffsiteLocationEvent_(config, event) {
  var location = String(event.location || "").trim();
  return Boolean(location) && !isOfficeLocation_(config, location);
}

function weeklyAwayDays_(config, now, events) {
  var weekStart = startOfLocalWeekMonday_(now);
  var days = [];
  for (var offset = 0; offset < 5; offset += 1) {
    var day = addDays_(weekStart, offset);
    if (dayHasAwayBlocker_(config, day, events)) {
      days.push(DAY_KEYS[day.getDay()]);
    }
  }
  return days;
}

function dayHasAwayBlocker_(config, day, events) {
  var windows = officeWindowsForDate_(config, day);
  if (!windows.length) {
    return false;
  }

  return events.some(function(event) {
    if (!isAwayDayCandidate_(config, event)) {
      return false;
    }
    if (event.allDay) {
      return eventOverlapsDay_(event, day);
    }
    return windows.some(function(window) {
      return event.start < window.end && window.start < event.end;
    });
  });
}

function dayHasFullAwayBlocker_(config, day, events) {
  var windows = officeWindowsForDate_(config, day);
  if (!windows.length) {
    return false;
  }

  var candidates = events.filter(function(event) {
    return isAwayDayCandidate_(config, event) && eventOverlapsDay_(event, day);
  });
  if (!candidates.length) {
    return false;
  }

  if (candidates.some(function(event) {
    return event.allDay;
  })) {
    return true;
  }

  return windows.every(function(window) {
    return candidates.some(function(event) {
      return event.start <= window.start && window.end <= event.end;
    });
  });
}

function isAwayDayCandidate_(config, event) {
  if (isAwayEvent_(config, event) || isOffsiteLocationEvent_(config, event)) {
    return true;
  }

  var titleStatus = titleStatusForEvent_(config, event);
  if (titleStatus && ["away", "leave", "offsite"].indexOf(titleStatus.state) !== -1) {
    return true;
  }

  if (isWorkingLocation_(event)) {
    var workingLocation = describeWorkingLocation_(event);
    return !workingLocation.availableHere;
  }

  return false;
}

function isOfficePresenceOverridableEvent_(config, event) {
  if (!event) {
    return false;
  }

  if (isAwayEvent_(config, event) || isOffsiteLocationEvent_(config, event)) {
    return true;
  }

  if (isWorkingLocation_(event)) {
    return !describeWorkingLocation_(event).availableHere;
  }

  return isOfficePresenceOverridableStatus_(titleStatusForEvent_(config, event));
}

function isOfficePresenceOverridableStatus_(status) {
  return Boolean(status) && ["away", "leave", "offsite", "remote"].indexOf(status.state) !== -1;
}

function eventOverlapsDay_(event, day) {
  var dayEnd = addDays_(day, 1);
  return event.start < dayEnd && day < event.end;
}

function firstTitleStatus_(config, events) {
  for (var index = 0; index < events.length; index += 1) {
    var status = titleStatusForEvent_(config, events[index]);
    if (status) {
      status.event = events[index];
      return status;
    }
  }
  return null;
}

function classifyCurrentStatusWithLlm_(config, now, currentEvents) {
  if (!config.llm.enabled) {
    return null;
  }

  var candidates = currentEvents
    .filter(function(event) {
      return !isOfficeEvent_(config, event) && !isWorkingLocation_(event);
    })
    .slice(0, config.llm.maxEvents);

  if (!candidates.length) {
    return null;
  }

  try {
    var input = {
      now: now.toISOString(),
      time_zone: config.timeZone,
      office_location_keywords: config.officeLocationKeywords || [],
      events: candidates.map(function(event) {
        return {
          id: event.id || "",
          title: event.summary || "",
          location: event.location || "",
          event_type: event.eventType || "default",
          transparency: event.transparency || "opaque",
          all_day: Boolean(event.allDay),
          start: event.start.toISOString(),
          end: event.end.toISOString()
        };
      })
    };

    var classification = requestLlmClassification_(config, input);
    if (!classification || !classification.should_override) {
      return null;
    }

    var status = statusFromLlmClassification_(classification);
    if (!status) {
      return null;
    }

    var matchedEvent = eventForClassification_(classification, candidates);
    if (status.state === "remote" && !isRemoteTitleEvent_(config, matchedEvent)) {
      return null;
    }

    status.currentUntil = matchedEvent
      ? matchedEvent.end
      : currentUntilForClassification_(classification, candidates);
    return status;
  } catch (error) {
    return null;
  }
}

function classifyDailyStatusWithLlm_(config, now, events, context) {
  if (!config.llm.enabled) {
    return null;
  }

  var day = startOfLocalDay_(now);
  var candidates = events
    .filter(function(event) {
      return eventOverlapsDay_(event, day);
    })
    .filter(function(event) {
      return !isOfficeEvent_(config, event);
    })
    .slice(0, config.llm.dailyMaxEvents);

  if (!candidates.length) {
    return null;
  }

  try {
    var input = {
      task: "daily_office_door_status",
      now: now.toISOString(),
      time_zone: config.timeZone,
      office_hours: officeHoursText_(config, now),
      has_office_hours_today: Boolean(context.hasOfficeHoursToday),
      presence: {
        office: Boolean(context.geofenceOffice),
        campus: Boolean(context.geofenceCampus),
        away: Boolean(context.geofenceAway)
      },
      events: candidates.map(function(event) {
        return {
          id: event.id || "",
          title: event.summary || "",
          location: event.location || "",
          event_type: event.eventType || "default",
          transparency: event.transparency || "opaque",
          all_day: Boolean(event.allDay),
          start: event.start.toISOString(),
          end: event.end.toISOString()
        };
      })
    };

    var classification = requestLlmClassification_(
      config,
      input,
      llmDailyStatusInstructions_(),
      llmDailyStatusSchema_(),
      "office_door_daily_status"
    );
    if (!classification || !classification.should_override) {
      return null;
    }

    var dayStatus = String(classification.day_status || "");
    if (["office", "scheduled", "away", "campus", "closed"].indexOf(dayStatus) === -1) {
      return null;
    }

    return {
      dayStatus: dayStatus,
      reasonKind: String(classification.reason_kind || ""),
      primaryEventId: String(classification.primary_event_id || "")
    };
  } catch (error) {
    return null;
  }
}

function requestLlmClassification_(config, input, instructions, schema, schemaName) {
  if (config.llm.provider === "mindlogic") {
    return requestMindlogicClassification_(config, input, instructions, schema);
  }
  if (config.llm.provider === "openai") {
    return requestOpenAiClassification_(config, input, instructions, schema, schemaName);
  }
  return null;
}

function requestMindlogicClassification_(config, input, instructions, schema) {
  if (!config.mindlogic.apiKey) {
    return null;
  }

  var url = trimTrailingSlash_(config.mindlogic.baseUrl) + "/chat/completions/";
  var prompt = instructions || llmStatusInstructions_();
  var outputSchema = schema || llmStatusSchema_();
  var payload = {
    model: config.mindlogic.model,
    messages: [
      {
        role: "system",
        content: prompt + " Respond with only a compact JSON object matching this schema: " +
          JSON.stringify(outputSchema)
      },
      {
        role: "user",
        content: JSON.stringify(input)
      }
    ],
    max_tokens: 300,
    temperature: 0,
    response_format: {
      type: "json_object"
    }
  };

  var response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + config.mindlogic.apiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    delete payload.response_format;
    response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: {
        Authorization: "Bearer " + config.mindlogic.apiKey
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
      return null;
    }
  }

  var body = JSON.parse(response.getContentText() || "{}");
  var content = body.choices &&
    body.choices[0] &&
    body.choices[0].message &&
    body.choices[0].message.content;
  return parseClassificationJson_(content);
}

function requestOpenAiClassification_(config, input, instructions, schema, schemaName) {
  if (!config.openai.apiKey) {
    return null;
  }

  var prompt = instructions || llmStatusInstructions_();
  var outputSchema = schema || llmStatusSchema_();
  var response = UrlFetchApp.fetch("https://api.openai.com/v1/responses", {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + config.openai.apiKey
    },
    payload: JSON.stringify({
      model: config.openai.model,
      store: false,
      max_output_tokens: 300,
      instructions: prompt,
      input: JSON.stringify(input),
      text: {
        format: {
          type: "json_schema",
          name: schemaName || "office_door_status",
          strict: true,
          schema: outputSchema
        }
      }
    }),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    return null;
  }

  var body = JSON.parse(response.getContentText() || "{}");
  return parseClassificationJson_(extractOpenAiOutputText_(body));
}

function testMindlogicDailyClassification_(config, input) {
  if (!config.mindlogic.apiKey) {
    return { ok: false, error: "MINDLOGIC_API_KEY is missing." };
  }

  var payload = {
    model: config.mindlogic.model,
    messages: [
      {
        role: "system",
        content: llmDailyStatusInstructions_() + " Respond with only a compact JSON object matching this schema: " +
          JSON.stringify(llmDailyStatusSchema_())
      },
      {
        role: "user",
        content: JSON.stringify(input)
      }
    ],
    max_tokens: 300,
    temperature: 0,
    response_format: {
      type: "json_object"
    }
  };
  var first = postMindlogicTest_(config, payload);
  var finalResponse = first;
  if (first.code < 200 || first.code >= 300) {
    delete payload.response_format;
    finalResponse = postMindlogicTest_(config, payload);
    finalResponse.first_code = first.code;
    finalResponse.first_error_preview = first.error_preview || "";
  }
  return finalResponse;
}

function postMindlogicTest_(config, payload) {
  var response = UrlFetchApp.fetch(
    trimTrailingSlash_(config.mindlogic.baseUrl) + "/chat/completions/",
    {
      method: "post",
      contentType: "application/json",
      headers: {
        Authorization: "Bearer " + config.mindlogic.apiKey
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    }
  );
  var code = response.getResponseCode();
  var text = response.getContentText() || "";
  var result = {
    ok: code >= 200 && code < 300,
    code: code,
    model: config.mindlogic.model,
    base_url: trimTrailingSlash_(config.mindlogic.baseUrl)
  };
  if (!result.ok) {
    result.error_preview = text.slice(0, 240);
    return result;
  }

  var body = JSON.parse(text || "{}");
  var content = body.choices &&
    body.choices[0] &&
    body.choices[0].message &&
    body.choices[0].message.content;
  result.classification = parseClassificationJson_(content);
  return result;
}

function testOpenAiDailyClassification_(config, input) {
  if (!config.openai.apiKey) {
    return { ok: false, error: "OPENAI_API_KEY is missing." };
  }

  var response = UrlFetchApp.fetch("https://api.openai.com/v1/responses", {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + config.openai.apiKey
    },
    payload: JSON.stringify({
      model: config.openai.model,
      store: false,
      max_output_tokens: 300,
      instructions: llmDailyStatusInstructions_(),
      input: JSON.stringify(input),
      text: {
        format: {
          type: "json_schema",
          name: "office_door_daily_status",
          strict: true,
          schema: llmDailyStatusSchema_()
        }
      }
    }),
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  var text = response.getContentText() || "";
  var result = {
    ok: code >= 200 && code < 300,
    code: code,
    model: config.openai.model
  };
  if (!result.ok) {
    result.error_preview = text.slice(0, 240);
    return result;
  }
  var body = JSON.parse(text || "{}");
  result.classification = parseClassificationJson_(extractOpenAiOutputText_(body));
  return result;
}

function parseClassificationJson_(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }

  var text = String(value).trim();
  try {
    return JSON.parse(text);
  } catch (error) {
    var start = text.indexOf("{");
    var end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (nestedError) {
      return null;
    }
  }
}

function llmStatusInstructions_() {
  return [
    "Classify Prof. Hyunwoo Kim's current office-door status from calendar events.",
    "The display is public, so never reveal event titles, private names, or exact locations.",
    "All user-facing status labels, headlines, and details must be in English.",
    "Return only the structured JSON schema fields.",
    "Use Korean and English context in titles.",
    "Prefer the most restrictive accurate status.",
    "Use offsite for business trips, external appointments, conferences, seminars away from the office, or non-office locations.",
    "Use leave for vacation, PTO, annual leave, sick leave, personal leave, or all-day leave.",
    "Use teaching for classes, lectures, courses, labs, or teaching sessions.",
    "Use meeting for meetings, calls, interviews, advising, seminars, or reviews.",
    "Use busy for opaque appointments that do not fit a more specific status.",
    "Use remote for working from home or remote work.",
    "Use away for generic out-of-office or unavailable status that is not leave or travel.",
    "If the events should not change the display status, set should_override to false and state to available."
  ].join(" ");
}

function llmStatusSchema_() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      should_override: {
        type: "boolean",
        description: "Whether this classification should override normal availability."
      },
      state: {
        type: "string",
        enum: ["available", "busy", "meeting", "away", "leave", "teaching", "remote", "offsite"]
      },
      detail_kind: {
        type: "string",
        enum: ["available", "busy", "meeting", "away", "leave", "teaching", "remote", "offsite", "travel"]
      },
      event_id: {
        type: "string",
        description: "The event id that best explains the classification, or an empty string."
      }
    },
    required: ["should_override", "state", "detail_kind", "event_id"]
  };
}

function llmDailyStatusInstructions_() {
  return [
    "Classify Prof. Hyunwoo Kim's whole-day office-door display from today's calendar events.",
    "This is not only the current time; decide whether visitors should expect office availability for the day.",
    "The display is public, so never reveal event titles, private names, exact locations, or sensitive details.",
    "Use Korean and English context in event titles and locations.",
    "Return only the structured JSON schema fields.",
    "Use away when an all-day or major office-hours event means the professor is away from the office, off campus, offsite, traveling, visiting an external institution, at a conference, on leave, on vacation, remote, or otherwise not available for office visits.",
    "Korean titles such as '한의학연구원 방문', external institution visits, hospital visits, conferences, business trips, and site visits should be classified as away/offsite unless clearly cancelled or transparent.",
    "Use scheduled when the professor is on campus but office visits are limited by classes, lectures, meetings, advising, seminars, calls, lunch, or other appointments during office hours.",
    "Use campus only when presence says campus, there is no away/offsite day, and the person is nearby but not necessarily in the office.",
    "Use office when today has office hours and the calendar does not meaningfully restrict visits.",
    "Use closed when there are no office hours today.",
    "Prefer the most restrictive accurate public status."
  ].join(" ");
}

function llmDailyStatusSchema_() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      should_override: {
        type: "boolean",
        description: "Whether the calendar context is sufficient to classify the daily display."
      },
      day_status: {
        type: "string",
        enum: ["office", "scheduled", "away", "campus", "closed"]
      },
      reason_kind: {
        type: "string",
        enum: ["available", "meeting", "teaching", "lunch", "busy", "offsite", "leave", "remote", "campus", "closed"]
      },
      primary_event_id: {
        type: "string",
        description: "The event id that best explains the classification, or an empty string."
      }
    },
    required: ["should_override", "day_status", "reason_kind", "primary_event_id"]
  };
}

function extractOpenAiOutputText_(body) {
  if (body.output_text) {
    return body.output_text;
  }

  var output = body.output || [];
  for (var outputIndex = 0; outputIndex < output.length; outputIndex += 1) {
    var content = output[outputIndex].content || [];
    for (var contentIndex = 0; contentIndex < content.length; contentIndex += 1) {
      var item = content[contentIndex];
      if ((item.type === "output_text" || item.type === "text") && item.text) {
        return item.text;
      }
    }
  }

  return "";
}

function trimTrailingSlash_(value) {
  return String(value || "").replace(/\/+$/, "");
}

function statusFromLlmClassification_(classification) {
  var state = String(classification.state || "");
  var detailKind = String(classification.detail_kind || state);

  var detailByKind = {
    available: {
      state: "available",
      headline: "Available",
      detail: "Visits welcome."
    },
    busy: {
      state: "busy",
      headline: "Busy",
      detail: "Busy right now."
    },
    meeting: {
      state: "meeting",
      headline: "In a Meeting",
      detail: "Meeting in progress."
    },
    away: {
      state: "away",
      headline: "Out of Office",
      detail: "Out of office right now."
    },
    leave: {
      state: "leave",
      headline: "Out of Office",
      detail: "Out of office right now."
    },
    teaching: {
      state: "teaching",
      headline: "In Class",
      detail: "Class in session."
    },
    remote: {
      state: "remote",
      headline: "Out of Office",
      detail: "Out of office."
    },
    offsite: {
      state: "offsite",
      headline: "Out of Office",
      detail: "Offsite appointment."
    },
    travel: {
      state: "offsite",
      headline: "Out of Office",
      detail: "Business trip."
    }
  };

  var status = detailByKind[detailKind] || detailByKind[state];
  if (!status || status.state === "available") {
    return null;
  }

  return {
    state: status.state,
    headline: status.headline,
    detail: status.detail,
    currentUntil: null
  };
}

function currentUntilForClassification_(classification, events) {
  var matched = eventForClassification_(classification, events);
  if (matched) {
    return matched.end;
  }

  return events.reduce(function(latest, event) {
    return !latest || event.end > latest ? event.end : latest;
  }, null);
}

function eventForClassification_(classification, events) {
  var eventId = String(classification.event_id || "");
  return events.find(function(event) {
    return String(event.id || "") === eventId;
  }) || null;
}

function isRemoteTitleEvent_(config, event) {
  if (!event) {
    return false;
  }
  var keywords = config.titleStatusKeywords || {};
  return includesKeyword_(event.summary || "", keywords.remote || []);
}

function titleStatusForEvent_(config, event) {
  if (isOfficeEvent_(config, event)) {
    return null;
  }

  var title = event.summary || "";
  var keywords = config.titleStatusKeywords || {};
  if (includesKeyword_(title, keywords.travel || [])) {
    return {
      state: "offsite",
      headline: "Out of Office",
      detail: event.allDay ? "Business trip today." : "Business trip."
    };
  }
  if (includesKeyword_(title, keywords.leave || [])) {
    return {
      state: "leave",
      headline: "Out of Office",
      detail: event.allDay ? "Out of office today." : "Out of office right now."
    };
  }
  if (isRemoteTitleEvent_(config, event)) {
    return {
      state: "remote",
      headline: "Out of Office",
      detail: event.allDay ? "Out of office today." : "Out of office."
    };
  }
  if (includesKeyword_(title, keywords.lunch || [])) {
    return {
      state: "lunch",
      headline: "Lunch Break",
      detail: "Back after lunch."
    };
  }
  if (includesKeyword_(title, keywords.teaching || [])) {
    return {
      state: "teaching",
      headline: "In Class",
      detail: "Class in session."
    };
  }
  if (includesKeyword_(title, keywords.meeting || [])) {
    return {
      state: "meeting",
      headline: "In a Meeting",
      detail: "Meeting in progress."
    };
  }
  return null;
}

function isTitleBlockingEvent_(config, event) {
  return Boolean(titleStatusForEvent_(config, event));
}

function isBusyEvent_(event) {
  if (event.eventType === "workingLocation") {
    return false;
  }
  if (event.eventType === "outOfOffice" || event.eventType === "focusTime") {
    return true;
  }
  return event.transparency !== "transparent";
}

function includesKeyword_(text, keywords) {
  var lower = String(text || "").toLowerCase();
  return keywords.some(function(keyword) {
    return lower.indexOf(String(keyword).toLowerCase()) !== -1;
  });
}

function isOfficeLocation_(config, location) {
  var officeLocations = config.officeLocationKeywords || [];
  if (!officeLocations.length) {
    return false;
  }

  var normalizedLocation = normalizeLocationText_(location);
  return officeLocations.some(function(officeLocation) {
    return normalizedLocation.indexOf(normalizeLocationText_(officeLocation)) !== -1;
  });
}

function normalizeLocationText_(value) {
  return String(value || "").toLowerCase().replace(/[\s,.-]/g, "");
}

function describeWorkingLocation_(event) {
  var props = event.workingLocationProperties || {};
  if (props.type === "officeLocation") {
    return {
      availableHere: true,
      label: props.officeLocation && props.officeLocation.label
        ? props.officeLocation.label
        : "At the office."
    };
  }
  if (props.type === "homeOffice") {
    return {
      availableHere: false,
      label: "Working from home."
    };
  }
  var label = props.customLocation && props.customLocation.label
    ? props.customLocation.label
    : event.location || "Working away from the office.";
  return {
    availableHere: includesKeyword_(label, ["office", "사무실", "연구실"]),
    label: label
  };
}

function getOfficeInfo_(config, now, events) {
  var calendarWindows = events
    .filter(function(event) {
      return isOfficeEvent_(config, event);
    })
    .map(function(event) {
      return {
        start: event.start,
        end: event.end,
        source: "calendar"
      };
    });

  var staticWindows = officeWindowsForDate_(config, now).map(function(window) {
    return {
      start: window.start,
      end: window.end,
      source: "schedule"
    };
  });

  var windows = calendarWindows.concat(staticWindows).sort(function(a, b) {
    return a.start - b.start;
  });
  var currentWindow = windows.find(function(window) {
    return window.start <= now && now < window.end;
  }) || null;
  var nextWindow = windows.find(function(window) {
    return window.start > now;
  }) || nextOfficeWindowAfter_(config, now);

  return {
    isOpen: Boolean(currentWindow),
    currentWindow: currentWindow,
    nextWindow: nextWindow
  };
}

function officeWindowsForDate_(config, date) {
  var key = DAY_KEYS[date.getDay()];
  var windows = (config.officeHours && config.officeHours[key]) || [];
  return windows.map(function(window) {
    return {
      start: timeOnDate_(date, window[0]),
      end: timeOnDate_(date, window[1])
    };
  });
}

function hasOfficeHoursOnDate_(config, date) {
  return officeWindowsForDate_(config, date).length > 0;
}

function officeHoursText_(config, date) {
  var windows = officeWindowsForDate_(config, date);
  if (!windows.length) {
    return "No hours today";
  }
  return windows.map(function(window) {
    return formatTime_(window.start, config) + "-" + formatTime_(window.end, config);
  }).join(" / ");
}

function overlapsOfficeHours_(config, event) {
  var day = startOfLocalDay_(event.start);
  var lastDay = startOfLocalDay_(event.end);

  while (day <= lastDay) {
    if (officeWindowsForDate_(config, day).some(function(window) {
      return event.start < window.end && window.start < event.end;
    })) {
      return true;
    }
    day = addDays_(day, 1);
  }

  return false;
}

function nextOfficeWindowAfter_(config, date) {
  for (var offset = 0; offset < 14; offset += 1) {
    var day = addDays_(startOfLocalDay_(date), offset);
    var windows = officeWindowsForDate_(config, day);
    var next = windows.find(function(window) {
      return window.end > date;
    });
    if (next) {
      return {
        start: next.start,
        end: next.end,
        source: "schedule"
      };
    }
  }
  return null;
}

function timeOnDate_(date, hhmm) {
  var parts = hhmm.split(":").map(Number);
  var result = new Date(date);
  result.setHours(parts[0], parts[1], 0, 0);
  return result;
}

function findNextAvailable_(config, now, events) {
  var candidate = new Date(now);

  for (var attempts = 0; attempts < 40; attempts += 1) {
    var officeInfo = getOfficeInfo_(config, candidate, events);
    if (!officeInfo.isOpen) {
      if (!officeInfo.nextWindow) {
        return null;
      }
      candidate = new Date(officeInfo.nextWindow.start);
      continue;
    }

    var implicitBlocker = implicitAvailabilityBlocker_(config, candidate);
    if (implicitBlocker) {
      candidate = new Date(implicitBlocker.end);
      continue;
    }

    var blocker = events.find(function(event) {
      return includesTime_(event, candidate) && isAvailabilityBlockerEvent_(config, event);
    });
    if (blocker) {
      candidate = new Date(blocker.end);
      continue;
    }

    return candidate;
  }

  return null;
}

function isAvailabilityBlockerEvent_(config, event) {
  if (isOfficeEvent_(config, event)) {
    return false;
  }
  if (isAwayEvent_(config, event) || isOffsiteLocationEvent_(config, event) || isTitleBlockingEvent_(config, event)) {
    return true;
  }
  if (isWorkingLocation_(event)) {
    return !describeWorkingLocation_(event).availableHere;
  }
  return isBusyEvent_(event);
}

function implicitAvailabilityBlocker_(config, date) {
  if (!hasOfficeHoursOnDate_(config, date)) {
    return null;
  }
  return implicitLunchBreak_(config, date);
}

function dailyAgendaEvents_(config, now, events) {
  var day = startOfLocalDay_(now);
  return events
    .filter(function(event) {
      return !event.allDay;
    })
    .filter(function(event) {
      return eventOverlapsDay_(event, day);
    })
    .filter(function(event) {
      return overlapsOfficeHours_(config, event);
    })
    .filter(function(event) {
      return !isOfficeEvent_(config, event) && !isWorkingLocation_(event);
    })
    .sort(function(a, b) {
      return a.start - b.start;
    })
    .slice(0, 5);
}

function dailyBestAfter_(config, now, events) {
  var blockers = dailyAgendaEvents_(config, now, events).filter(function(event) {
    return isAvailabilityBlockerEvent_(config, event);
  });
  if (!blockers.length) {
    return null;
  }

  var latestEnd = blockers.reduce(function(latest, event) {
    return !latest || event.end > latest ? event.end : latest;
  }, null);
  if (!latestEnd) {
    return null;
  }

  var hasRemainingOfficeHours = officeWindowsForDate_(config, latestEnd).some(function(window) {
    return latestEnd < window.end;
  });
  if (hasRemainingOfficeHours) {
    return latestEnd;
  }

  return findNextAvailable_(config, addDays_(startOfLocalDay_(now), 1), events);
}

function presentAgendaEvent_(config, event) {
  var type = agendaType_(config, event);
  return {
    id: event.id,
    title: type.label,
    type: type.key,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
    allDay: event.allDay
  };
}

function agendaType_(config, event) {
  var titleStatus = titleStatusForEvent_(config, event);
  if (titleStatus && titleStatus.state === "teaching") {
    return { key: "teaching", label: "In Class" };
  }
  if (titleStatus && titleStatus.state === "meeting") {
    return { key: "meeting", label: "Meeting" };
  }
  if (titleStatus && titleStatus.state === "lunch") {
    return { key: "lunch", label: "Lunch Break" };
  }
  if (titleStatus && ["away", "leave", "offsite", "remote"].indexOf(titleStatus.state) !== -1) {
    return { key: "away", label: "Out of Office" };
  }
  if (isAwayEvent_(config, event) || isOffsiteLocationEvent_(config, event)) {
    return { key: "away", label: "Out of Office" };
  }
  if (isOfficeEvent_(config, event)) {
    return { key: "office", label: "Office Hours" };
  }
  if (isWorkingLocation_(event)) {
    return { key: "location", label: "Work Location" };
  }
  if (isBusyEvent_(event)) {
    return { key: "meeting", label: "Meeting" };
  }
  return { key: "available", label: "In Office" };
}

function toSenseCraftStatus_(status, config) {
  if (config.dailyMode) {
    return toDailySenseCraftStatus_(status, config);
  }

  var displayStatus = simplifyDisplayStatus_(status);
  var agenda = status.agenda || [];
  var first = agenda[0] || null;
  var second = agenda[1] || null;
  var third = agenda[2] || null;
  var nextAvailableText = displayStatus.state === "campus"
    ? "Soon"
    : formatRelativeDateTime_(status.nextAvailableAt, status.now, config);
  var currentUntilText = status.availableByPresence
    ? "While here"
    : formatRelativeDateTime_(status.currentUntil, status.now, config);

  return {
    display_name: status.displayName || "",
    date: formatDateLabel_(status.now, config),
    state: displayStatus.state || "",
    status_label: senseCraftStateLabel_(status.state, displayStatus.state),
    headline: displayStatus.headline || "",
    detail: displayStatus.detail || "",
    next_available: nextAvailableText,
    current_until: currentUntilText,
    todays_hours: status.officeHoursText || "",
    away_days: status.awayDays || [],
    battery_level: "",
    up_next_1_time: formatAgendaRange_(first, config, status.now),
    up_next_1_title: first && first.title ? first.title : "",
    up_next_1_type: first && first.type ? first.type : "",
    up_next_2_time: formatAgendaRange_(second, config, status.now),
    up_next_2_title: second && second.title ? second.title : "",
    up_next_2_type: second && second.type ? second.type : "",
    up_next_3_time: formatAgendaRange_(third, config, status.now),
    up_next_3_title: third && third.title ? third.title : "",
    up_next_3_type: third && third.type ? third.type : "",
    updated_at: formatDateTimeLabel_(status.generatedAt, config),
    source: status.connection && status.connection.demo ? "demo" : "calendar"
  };
}

function toDailySenseCraftStatus_(status, config) {
  var now = status.now ? new Date(status.now) : new Date();
  var hasOfficeHours = Boolean(status.hasOfficeHoursToday);
  var onCampus = Boolean(status.geofenceOffice || status.geofenceCampus);
  var dailyLlmStatus = status.dailyLlmStatus || null;
  var dailyLlmDayStatus = dailyLlmStatus ? dailyLlmStatus.dayStatus : "";
  var hasVisitHours = hasOfficeHours && dailyLlmDayStatus !== "closed";
  var outToday = hasVisitHours && (
    dailyLlmDayStatus === "away" ||
    (!onCampus && Boolean(
      status.geofenceAway ||
      status.fullAwayDay ||
      isDailyOutOfOfficeState_(status.state)
    ))
  );
  var agenda = status.dailyAgenda || [];
  var first = agenda[0] || null;
  var second = agenda[1] || null;
  var hasAgenda = dailyLlmDayStatus
    ? dailyLlmDayStatus === "scheduled"
    : agenda.length > 0;
  var dailyState = hasVisitHours ? "available" : "setup";
  var statusLabel = hasVisitHours ? "CAMPUS DAY" : "NO HOURS";
  var headline = hasVisitHours ? "Office Hours" : "No Office Hours";
  var detail = hasVisitHours
    ? "Visits welcome during office hours."
    : "Weekend or holiday schedule.";
  var nextLabel = hasVisitHours ? "VISIT WINDOW" : "NEXT OFFICE DAY";
  var nextValue = hasVisitHours
    ? officeVisitWindowText_(config, now)
    : formatDailyRightValue_(status.nextAvailableAt, status.now, config);
  var planLabel = "Today's Plan";
  var planTitle = hasVisitHours ? "Open office hours" : "Office closed today";
  var planType = hasVisitHours ? "available" : "closed";

  if (outToday) {
    dailyState = "away";
    statusLabel = "OFF CAMPUS";
    headline = "Out Today";
    detail = "Not on campus today.";
    nextLabel = "NEXT OFFICE DAY";
    nextValue = formatDailyRightValue_(status.dailyLlmNextAvailableAt || status.nextAvailableAt, status.now, config);
    planLabel = "URGENT MATTERS";
    planTitle = "Please visit Room 534\n(생약학 연구실)";
    planType = "away";
    first = null;
    second = null;
  } else if (hasVisitHours && hasAgenda) {
    dailyState = "lunch";
    statusLabel = "SCHEDULED";
    headline = "Limited Today";
    detail = "On campus, but visits are limited.";
    nextLabel = "BEST AFTER";
    nextValue = formatDailyRightValue_(status.dailyBestAfterAt || status.nextAvailableAt, status.now, config);
    if (!first && dailyLlmDayStatus === "scheduled") {
      planTitle = "Schedule limits visits";
      planType = "meeting";
    }
  } else if (hasVisitHours && (dailyLlmDayStatus === "campus" || (status.geofenceCampus && !status.geofenceOffice))) {
    dailyState = "campus";
    statusLabel = "ON CAMPUS";
    headline = "On Campus";
    detail = "May step away from the office.";
    nextLabel = "BEST CHANCE";
    planTitle = "Campus work day";
    planType = "campus";
  }

  return {
    mode: "daily",
    display_name: status.displayName || "",
    date: formatDateLabel_(status.now, config),
    state: dailyState,
    status_label: statusLabel,
    headline: headline,
    detail: detail,
    next_label: nextLabel,
    next_available: nextValue || "",
    current_until: "",
    todays_hours: status.officeHoursText || "",
    away_days: status.awayDays || [],
    battery_level: "",
    plan_label: planLabel,
    up_next_1_time: first ? formatAgendaRange_(first, config, status.now) : "",
    up_next_1_title: first && first.title ? first.title : planTitle,
    up_next_1_type: first && first.type ? first.type : planType,
    up_next_2_time: second ? formatAgendaRange_(second, config, status.now) : "",
    up_next_2_title: second && second.title ? second.title : "",
    up_next_2_type: second && second.type ? second.type : "",
    up_next_3_time: "",
    up_next_3_title: "",
    up_next_3_type: "",
    updated_at: formatDateTimeLabel_(status.generatedAt, config),
    source: status.connection && status.connection.demo ? "demo" : "calendar"
  };
}

function isDailyOutOfOfficeState_(state) {
  return ["away", "leave", "offsite", "remote"].indexOf(String(state || "")) !== -1;
}

function simplifyDisplayStatus_(status) {
  var state = status.state || "";
  var detail = status.detail || "";

  if (state === "available") {
    return {
      state: "available",
      headline: "In Office",
      detail: "Please knock."
    };
  }

  if (state === "campus") {
    return {
      state: "campus",
      headline: "On Campus",
      detail: "Back soon."
    };
  }

  if (state === "lunch") {
    return {
      state: "lunch",
      headline: "Lunch Break",
      detail: detail || "Back soon."
    };
  }

  if (state === "teaching") {
    return {
      state: "teaching",
      headline: "In Class",
      detail: "Class in session."
    };
  }

  if (["busy", "meeting", "focus"].indexOf(state) !== -1) {
    return {
      state: "meeting",
      headline: "In a Meeting",
      detail: "Please come back later."
    };
  }

  if (["away", "leave", "offsite", "off_hours", "closed", "remote"].indexOf(state) !== -1) {
    return {
      state: "away",
      headline: "Out of Office",
      detail: detail && detail.indexOf("Back ") === 0 ? detail : "Out of office."
    };
  }

  return {
    state: "away",
    headline: "Out of Office",
    detail: "Out of office."
  };
}

function publishSenseCraftToGitHub_(config, statusJson) {
  if (!config.github.token || !config.github.owner || !config.github.repo || !config.github.path) {
    throw new Error("GitHub Script Properties are incomplete.");
  }

  if (config.github.skipUnchanged) {
    var previousStatus = readGitHubFile_(config, config.github.path, true);
    if (previousStatus.content && !hasMeaningfulStatusChange_(previousStatus.content, statusJson)) {
      return;
    }
  }

  var files = [{ path: config.github.path, content: statusJson }];
  if (config.github.liveHtmlPath) {
    var current = readGitHubFile_(config, config.github.liveHtmlPath, false);
    files.push({
      path: config.github.liveHtmlPath,
      content: embedInitialStatusJson_(current.content, statusJson)
    });
  }

  publishGitHubFilesInOneCommit_(config, files, "Update SenseCraft status");
}

function hasMeaningfulStatusChange_(previousJson, nextJson) {
  try {
    return stableStatusJson_(previousJson) !== stableStatusJson_(nextJson);
  } catch (error) {
    return true;
  }
}

function stableStatusJson_(jsonText) {
  var parsed = JSON.parse(jsonText || "{}");
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    delete parsed.updated_at;
  }
  return stableStringify_(parsed);
}

function stableStringify_(value) {
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify_).join(",") + "]";
  }
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(function(key) {
      return JSON.stringify(key) + ":" + stableStringify_(value[key]);
    }).join(",") + "}";
  }
  return JSON.stringify(value);
}

function publishGitHubFilesInOneCommit_(config, files, message) {
  var ref = fetchGitHubJson_(
    config,
    "/git/ref/heads/" + encodeURIComponent(config.github.branch),
    { method: "get" }
  );
  var parentSha = ref.object && ref.object.sha;
  if (!parentSha) {
    throw new Error("Could not read GitHub branch ref.");
  }

  var parentCommit = fetchGitHubJson_(config, "/git/commits/" + parentSha, { method: "get" });
  var baseTreeSha = parentCommit.tree && parentCommit.tree.sha;
  if (!baseTreeSha) {
    throw new Error("Could not read GitHub base tree.");
  }

  var treeItems = files.map(function(file) {
    var blob = fetchGitHubJson_(config, "/git/blobs", {
      method: "post",
      payload: {
        content: file.content,
        encoding: "utf-8"
      }
    });
    return {
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha
    };
  });

  var tree = fetchGitHubJson_(config, "/git/trees", {
    method: "post",
    payload: {
      base_tree: baseTreeSha,
      tree: treeItems
    }
  });

  var commit = fetchGitHubJson_(config, "/git/commits", {
    method: "post",
    payload: {
      message: message || "Update SenseCraft status",
      tree: tree.sha,
      parents: [parentSha]
    }
  });

  fetchGitHubJson_(config, "/git/refs/heads/" + encodeURIComponent(config.github.branch), {
    method: "patch",
    payload: {
      sha: commit.sha,
      force: false
    }
  });
}

function fetchGitHubJson_(config, path, options) {
  var requestOptions = {
    method: options.method,
    headers: githubHeaders_(config),
    muteHttpExceptions: true
  };
  if (options.payload !== undefined) {
    requestOptions.contentType = "application/json";
    requestOptions.payload = JSON.stringify(options.payload);
  }

  var response = UrlFetchApp.fetch(githubRepoApiUrl_(config, path), requestOptions);
  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error("GitHub API request failed: " + code + " " + text);
  }
  return JSON.parse(text || "{}");
}

function readGitHubFile_(config, path, allowMissing) {
  var existing = UrlFetchApp.fetch(
    githubContentsUrl_(config, path) + "?ref=" + encodeURIComponent(config.github.branch),
    {
      method: "get",
      headers: githubHeaders_(config),
      muteHttpExceptions: true
    }
  );

  if (existing.getResponseCode() === 404 && allowMissing) {
    return { sha: "", content: "" };
  }

  if (existing.getResponseCode() !== 200) {
    throw new Error("Could not read GitHub file: " + existing.getContentText());
  }

  var body = JSON.parse(existing.getContentText() || "{}");
  var encoded = String(body.content || "").replace(/\s/g, "");
  var content = Utilities.newBlob(Utilities.base64Decode(encoded)).getDataAsString("UTF-8");
  return {
    sha: body.sha || "",
    content: content
  };
}

function githubContentsUrl_(config, path) {
  var apiPath = encodeURIComponent(path).replace(/%2F/g, "/");
  return githubRepoApiUrl_(config, "/contents/" + apiPath);
}

function githubRepoApiUrl_(config, path) {
  return "https://api.github.com/repos/" +
    encodeURIComponent(config.github.owner) +
    "/" +
    encodeURIComponent(config.github.repo) +
    path;
}

function embedInitialStatusJson_(html, statusJson) {
  var marker = /<script id="office-hours-initial-status" type="application\/json">[\s\S]*?<\/script>/;
  if (!marker.test(html)) {
    throw new Error("office-hours-live.html is missing the initial status marker.");
  }

  var safeJson = String(statusJson || "{}").replace(/</g, "\\u003c");
  var block = '<script id="office-hours-initial-status" type="application/json">\n' +
    safeJson +
    '\n    </script>';
  return html.replace(marker, block);
}

function githubHeaders_(config) {
  return {
    Authorization: "Bearer " + config.github.token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "sensecraft-office-hours-apps-script"
  };
}

function isGeofenceAway_(config, now) {
  return isRecentGeofenceStatus_("away", config, now);
}

function isGeofenceCampus_(config, now) {
  return isRecentGeofenceStatus_("campus", config, now) && !isOfficeExitGraceActive_(config, now);
}

function isGeofenceOffice_(config, now) {
  return isRecentGeofenceStatus_("office", config, now) || isOfficeExitGraceActive_(config, now);
}

function isRecentGeofenceStatus_(expectedStatus, config, now) {
  var props = PropertiesService.getScriptProperties();
  var status = String(props.getProperty("GEOFENCE_STATUS") || "").toLowerCase();
  var updatedAtText = props.getProperty("GEOFENCE_UPDATED_AT");
  if (status !== expectedStatus || !updatedAtText) {
    return false;
  }

  var updatedAt = new Date(updatedAtText);
  if (!isFinite(updatedAt.getTime())) {
    return false;
  }

  var ageMinutes = (now.getTime() - updatedAt.getTime()) / 60000;
  return ageMinutes <= config.location.staleMinutes;
}

function isOfficeExitGraceActive_(config, now) {
  var graceMinutes = config.location.officeExitGraceMinutes;
  if (!isFinite(graceMinutes) || graceMinutes <= 0) {
    return false;
  }

  if (!isRecentGeofenceStatus_("campus", config, now)) {
    return false;
  }

  var props = PropertiesService.getScriptProperties();
  var startedAtText = props.getProperty("GEOFENCE_OFFICE_EXIT_STARTED_AT");
  if (!startedAtText) {
    return false;
  }

  var startedAt = new Date(startedAtText);
  if (!isFinite(startedAt.getTime())) {
    return false;
  }

  var ageMinutes = (now.getTime() - startedAt.getTime()) / 60000;
  return ageMinutes >= 0 && ageMinutes <= graceMinutes;
}

function distanceBetweenKm_(lat1, lng1, lat2, lng2) {
  var earthKm = 6371;
  var dLat = degreesToRadians_(lat2 - lat1);
  var dLng = degreesToRadians_(lng2 - lng1);
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(degreesToRadians_(lat1)) *
      Math.cos(degreesToRadians_(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthKm * c;
}

function degreesToRadians_(degrees) {
  return degrees * Math.PI / 180;
}

function senseCraftStateLabel_(state, displayState) {
  var labels = {
    available: "VISITS OK",
    away: "OFFSITE",
    campus: "NEARBY",
    meeting: "DO NOT DISTURB",
    lunch: "LUNCH",
    busy: "DO NOT DISTURB",
    teaching: "TEACHING",
    focus: "DO NOT DISTURB",
    leave: "OFFSITE",
    remote: "OFFSITE",
    off_hours: "AFTER HOURS",
    offsite: "OFFSITE",
    closed: "AFTER HOURS",
    setup: "SETUP"
  };
  return labels[state] || labels[displayState] || "STATUS";
}

function officeVisitWindowText_(config, date) {
  var windows = officeWindowsForDate_(config, date);
  if (!windows.length) {
    return "";
  }
  return formatTime_(windows[0].start, config) + "\n" + formatTime_(windows[windows.length - 1].end, config);
}

function formatDailyRightValue_(value, nowValue, config) {
  if (!value) {
    return "";
  }
  return formatRelativeDateTime_(value, nowValue, config)
    .replace(/^Tomorrow\s+/, "Tomorrow\n")
    .replace(/^([A-Z][a-z]{2}\s+\d{1,2}),\s+/, "$1\n");
}

function formatDateLabel_(value, config) {
  if (!value) {
    return "";
  }
  return Utilities.formatDate(new Date(value), config.timeZone, "EEE, MMM d");
}

function formatDateTimeLabel_(value, config) {
  if (!value) {
    return "";
  }
  return Utilities.formatDate(new Date(value), config.timeZone, "MMM d, HH:mm");
}

function formatRelativeDateTime_(value, nowValue, config) {
  if (!value) {
    return "";
  }

  var date = new Date(value);
  var now = nowValue ? new Date(nowValue) : new Date();
  if (sameLocalDate_(date, now, config)) {
    return formatTime_(date, config);
  }

  var tomorrow = addDays_(now, 1);
  if (sameLocalDate_(date, tomorrow, config)) {
    return "Tomorrow " + formatTime_(date, config);
  }

  return formatDateTimeLabel_(value, config);
}

function formatSentenceDateTime_(value, nowValue, config) {
  return formatRelativeDateTime_(value, nowValue, config)
    .replace(/^Today\b/, "today")
    .replace(/^Tomorrow\b/, "tomorrow");
}

function formatAgendaRange_(item, config, nowValue) {
  if (!item) {
    return "";
  }

  var start = new Date(item.start);
  var end = new Date(item.end);
  var prefix = agendaDatePrefix_(start, nowValue, config);

  if (item.allDay) {
    return prefix ? prefix + " All Day" : "All Day";
  }
  return (prefix ? prefix + " " : "") + formatTime_(start, config) + "-" + formatTime_(end, config);
}

function agendaDatePrefix_(date, nowValue, config) {
  var now = nowValue ? new Date(nowValue) : new Date();
  if (sameLocalDate_(date, now, config)) {
    return "";
  }

  if (sameLocalDate_(date, addDays_(now, 1), config)) {
    return "Tomorrow";
  }

  return Utilities.formatDate(date, config.timeZone, "MMM d");
}

function formatTime_(date, config) {
  return Utilities.formatDate(date, config.timeZone, "HH:mm");
}

function sameLocalDate_(a, b, config) {
  return Utilities.formatDate(a, config.timeZone, "yyyy-MM-dd") ===
    Utilities.formatDate(b, config.timeZone, "yyyy-MM-dd");
}

function addDays_(date, days) {
  var result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMinutes_(date, minutes) {
  var result = new Date(date);
  result.setMinutes(result.getMinutes() + minutes);
  return result;
}

function startOfLocalWeekMonday_(date) {
  var result = startOfLocalDay_(date);
  var daysSinceMonday = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - daysSinceMonday);
  return result;
}

function startOfLocalDay_(date) {
  var result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function parseRequestBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return {};
  }
  var type = e.postData.type || "";
  if (type.indexOf("application/json") !== -1) {
    return JSON.parse(e.postData.contents || "{}");
  }

  var output = {};
  e.postData.contents.split("&").forEach(function(pair) {
    var parts = pair.split("=");
    if (parts[0]) {
      output[decodeURIComponent(parts[0])] = decodeURIComponent(parts.slice(1).join("=") || "");
    }
  });
  return output;
}

function jsonResponse_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function getConfig_() {
  var props = PropertiesService.getScriptProperties();
  var config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  config.dailyMode = propBool_(props, "DAILY_MODE", true);
  config.displayName = prop_(props, "DISPLAY_NAME", config.displayName);
  config.calendarId = prop_(props, "CALENDAR_ID", config.calendarId);
  config.timeZone = prop_(props, "TIME_ZONE", config.timeZone);
  config.showEventTitles = propBool_(props, "SHOW_EVENT_TITLES", config.showEventTitles);
  config.officeHours = propJson_(props, "OFFICE_HOURS_JSON", config.officeHours);
  config.lunchBreak = propJson_(props, "LUNCH_BREAK_JSON", config.lunchBreak);
  config.officeEventKeywords = propCsv_(props, "OFFICE_EVENT_KEYWORDS", config.officeEventKeywords);
  config.officeLocationKeywords = propCsv_(props, "OFFICE_LOCATION_KEYWORDS", config.officeLocationKeywords);
  config.awayKeywords = propCsv_(props, "AWAY_KEYWORDS", config.awayKeywords);
  config.titleStatusKeywords = {
    travel: propCsv_(props, "TITLE_TRAVEL_KEYWORDS", config.titleStatusKeywords.travel),
    leave: propCsv_(props, "TITLE_LEAVE_KEYWORDS", config.titleStatusKeywords.leave),
    remote: propCsv_(props, "TITLE_REMOTE_KEYWORDS", config.titleStatusKeywords.remote),
    lunch: propCsv_(props, "TITLE_LUNCH_KEYWORDS", config.titleStatusKeywords.lunch),
    teaching: propCsv_(props, "TITLE_TEACHING_KEYWORDS", config.titleStatusKeywords.teaching),
    meeting: propCsv_(props, "TITLE_MEETING_KEYWORDS", config.titleStatusKeywords.meeting)
  };

  var mindlogicApiKey = prop_(props, "MINDLOGIC_API_KEY", "");
  var openAiApiKey = prop_(props, "OPENAI_API_KEY", "");
  var defaultLlmProvider = mindlogicApiKey ? "mindlogic" : openAiApiKey ? "openai" : config.llm.provider;
  config.llm = {
    provider: String(prop_(props, "LLM_PROVIDER", defaultLlmProvider)).toLowerCase(),
    enabled: propBool_(props, "LLM_ENABLED", Boolean(mindlogicApiKey || openAiApiKey)),
    maxEvents: Number(prop_(props, "LLM_MAX_EVENTS", prop_(props, "OPENAI_MAX_EVENTS", "3"))),
    dailyMaxEvents: Number(prop_(props, "LLM_DAILY_MAX_EVENTS", "8"))
  };
  if (!isFinite(config.llm.maxEvents) || config.llm.maxEvents < 1) {
    config.llm.maxEvents = 3;
  }
  if (!isFinite(config.llm.dailyMaxEvents) || config.llm.dailyMaxEvents < 1) {
    config.llm.dailyMaxEvents = 8;
  }

  config.mindlogic = {
    apiKey: mindlogicApiKey,
    baseUrl: prop_(props, "MINDLOGIC_BASE_URL", config.mindlogic.baseUrl),
    model: prop_(props, "MINDLOGIC_MODEL", config.mindlogic.model)
  };

  config.openai = {
    apiKey: openAiApiKey,
    model: prop_(props, "OPENAI_MODEL", config.openai.model),
    enabled: propBool_(props, "OPENAI_ENABLED", Boolean(openAiApiKey))
  }

  config.github = {
    owner: prop_(props, "GITHUB_OWNER", "ChungmaruQ"),
    repo: prop_(props, "GITHUB_REPO", "ChungmaruQ.github.io"),
    branch: prop_(props, "GITHUB_BRANCH", "main"),
    path: prop_(props, "GITHUB_PATH", "sensecraft/status.json"),
    liveHtmlPath: prop_(props, "GITHUB_LIVE_HTML_PATH", "sensecraft/office-hours-live.html"),
    skipUnchanged: propBool_(props, "GITHUB_SKIP_UNCHANGED_STATUS", true),
    token: prop_(props, "GITHUB_TOKEN", "")
  };

  config.location = {
    webhookSecret: prop_(props, "LOCATION_WEBHOOK_SECRET", ""),
    officeLat: Number(prop_(props, "OFFICE_LAT", "")),
    officeLng: Number(prop_(props, "OFFICE_LNG", "")),
    radiusKm: Number(prop_(props, "OFFICE_RADIUS_KM", "5")),
    staleMinutes: Number(prop_(props, "LOCATION_STALE_MINUTES", "1440")),
    officeExitGraceMinutes: Number(prop_(props, "OFFICE_EXIT_GRACE_MINUTES", "5"))
  };
  if (!isFinite(config.location.officeExitGraceMinutes) || config.location.officeExitGraceMinutes < 0) {
    config.location.officeExitGraceMinutes = 5;
  }

  return config;
}

function prop_(props, key, fallback) {
  var value = props.getProperty(key);
  return value === null || value === undefined || value === "" ? fallback : value;
}

function propBool_(props, key, fallback) {
  var value = props.getProperty(key);
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  return String(value).toLowerCase() === "true";
}

function propJson_(props, key, fallback) {
  var value = props.getProperty(key);
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(
      key +
        " must be valid JSON. Paste raw JSON without wrapping quotes or backslashes. " +
        "Original error: " +
        error.message
    );
  }
}

function propCsv_(props, key, fallback) {
  var value = props.getProperty(key);
  if (!value) {
    return fallback;
  }
  return value.split(",").map(function(item) {
    return item.trim();
  }).filter(Boolean);
}
