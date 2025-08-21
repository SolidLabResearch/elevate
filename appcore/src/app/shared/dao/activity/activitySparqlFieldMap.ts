import { Bindings } from "@rdfjs/types";

export const ActivitySparqlFieldMap: {
  [key: string]: {
    graphPattern: string;
    requiredVariable: string;
    formatValue?: (bindings: Bindings) => any;
    ignore?: boolean;
    required?: boolean;
  };
} = {
  activity_name: {
    graphPattern: "?activity activo:name ?activity_name .",
    requiredVariable: "activity",
    required: true
  },
  activity_type: {
    graphPattern:
      "?activity a ?activity_type_class ." +
      "?activity_type_class rdfs:label ?activity_type ." +
      "?activity_type_class rdfs:subClassOf activo:Activity .",
    requiredVariable: "activity",
    required: true
  },
  activity_startTime: {
    graphPattern: "?activity activo:startTime ?activity_startTime .",
    requiredVariable: "activity",
    required: true
  },
  activity_endTime: {
    graphPattern: "?activity activo:endTime ?activity_endTime .",
    requiredVariable: "activity",
    required: true
  },
  activity_startTimestamp: {
    graphPattern: "",
    requiredVariable: "activity_startTime",
    formatValue: (bindings: Bindings) => {
      if (!bindings.has("activity_startTime")) {
        return null;
      }
      return Math.floor(new Date(bindings.get("activity_startTime").value).getTime() / 1000);
    },
    required: true
  },
  activity_endTimestamp: {
    graphPattern: "",
    requiredVariable: "activity_endTime",
    formatValue: (bindings: Bindings) => {
      if (!bindings.has("activity_endTime")) {
        return null;
      }
      return Math.floor(new Date(bindings.get("activity_endTime").value).getTime() / 1000);
    },
    required: true
  },
  activity_hasPowerMeter: {
    graphPattern: "?activity activo:hasPowerData ?activity_hasPowerMeter .", // alternate calculation
    requiredVariable: "activity",
    required: true
  },
  activity_trainer: {
    graphPattern: "?activity activo:isTrainer ?activity_trainer .",
    requiredVariable: "activity",
    required: true
  },
  activity_commute: {
    graphPattern: "?activity activo:isCommute ?activity_commute .",
    requiredVariable: "activity"
  },
  activity_manual: {
    graphPattern: "?activity activo:isManual ?activity_manual .",
    requiredVariable: "activity"
  },

  activity_athlete: {
    graphPattern: "?activity activo:hasAthlete ?activity_athlete .",
    requiredVariable: "activity",
    ignore: true,
    required: true
  },
  activity_athleteSnapshot_gender: {
    graphPattern: "?activity_athlete foaf:gender ?activity_athleteSnapshot_gender .",
    requiredVariable: "activity_athlete",
    required: true
  },
  activity_athleteSnapshot_age: {
    graphPattern: "?activity_athlete foaf:age ?activity_athleteSnapshot_age .", // possibly also use birthday
    requiredVariable: "activity_athlete"
  },
  activity_athleteSnapshot: {
    graphPattern: "?activity activo:hasPerformanceSnapshot ?activity_athleteSnapshot .",
    requiredVariable: "activity",
    ignore: true,
    required: true
  },
  activity_athleteSnapshot_athleteSettings_maxHr: {
    graphPattern: "?activity_athleteSnapshot activo:maxHeartRate ?activity_athleteSnapshot_athleteSettings_maxHr .",
    requiredVariable: "activity_athleteSnapshot",
    required: true
  },
  activity_athleteSnapshot_athleteSettings_restHr: {
    graphPattern: "?activity_athleteSnapshot activo:restHeartRate ?activity_athleteSnapshot_athleteSettings_restHr .",
    requiredVariable: "activity_athleteSnapshot",
    required: true
  },
  activity_athleteSnapshot_athleteSettings_lthr_default: {
    graphPattern:
      "?activity_athleteSnapshot activo:defaultLactateThreshold ?activity_athleteSnapshot_athleteSettings_lthr_default .",
    requiredVariable: "activity_athleteSnapshot"
  },
  activity_athleteSnapshot_athleteSettings_lthr_cycling: {
    graphPattern:
      "?activity_athleteSnapshot activo:cyclingLactateThreshold ?activity_athleteSnapshot_athleteSettings_lthr_cycling .",
    requiredVariable: "activity_athleteSnapshot"
  },
  activity_athleteSnapshot_athleteSettings_lthr_running: {
    graphPattern:
      "?activity_athleteSnapshot activo:runningLactateThreshold ?activity_athleteSnapshot_athleteSettings_lthr_running .",
    requiredVariable: "activity_athleteSnapshot"
  },
  activity_athleteSnapshot_athleteSettings_cyclingFtp: {
    graphPattern:
      "?activity_athleteSnapshot activo:cyclingFunctionalThresholdPower ?activity_athleteSnapshot_athleteSettings_cyclingFtp .",
    requiredVariable: "activity_athleteSnapshot"
  },
  activity_athleteSnapshot_athleteSettings_runningFtp: {
    graphPattern:
      "?activity_athleteSnapshot activo:runningFunctionalThresholdPower ?activity_athleteSnapshot_athleteSettings_runningFtp .",
    requiredVariable: "activity_athleteSnapshot"
  },
  activity_athleteSnapshot_athleteSettings_swimFtp: {
    graphPattern:
      "?activity_athleteSnapshot activo:swimmingFunctionalThresholdPower ?activity_athleteSnapshot_athleteSettings_swimFtp .",
    requiredVariable: "activity_athleteSnapshot"
  },
  activity_athleteSnapshot_athleteSettings_weight: {
    graphPattern: "?activity_athleteSnapshot activo:weight ?activity_athleteSnapshot_athleteSettings_weight .",
    requiredVariable: "activity_athleteSnapshot",
    required: true
  },

  activity_srcStats: {
    graphPattern: "?activity activo:hasSourceStats ?activity_srcStats .",
    requiredVariable: "activity",
    ignore: true
  },
  activity_srcStats_distance: {
    graphPattern: "?activity_srcStats activo:distance ?activity_srcStats_distance .",
    requiredVariable: "activity_srcStats"
  },
  activity_srcStats_elevationGain: {
    graphPattern: "?activity_srcStats_elevation activo:ascent ?activity_srcStats_elevationGain .",
    requiredVariable: "activity_srcStats_elevation"
  },
  activity_srcStats_elapsedTime: {
    graphPattern: "?activity_srcStats activo:elapsedTime ?activity_srcStats_elapsedTime .",
    requiredVariable: "activity_srcStats"
  },
  activity_srcStats_movingTime: {
    graphPattern: "?activity_srcStats activo:movingTime ?activity_srcStats_movingTime .",
    requiredVariable: "activity_srcStats"
  },
  activity_srcStats_pauseTime: {
    graphPattern: "?activity_srcStats activo:pauseTime ?activity_srcStats_pauseTime .",
    requiredVariable: "activity_srcStats"
  },
  activity_srcStats_moveRatio: {
    graphPattern: "?activity_srcStats activo:moveRatio ?activity_srcStats_moveRatio .",
    requiredVariable: "activity_srcStats"
  },
  activity_srcStats_calories: {
    graphPattern: "?activity_srcStats activo:calories ?activity_srcStats_calories .",
    requiredVariable: "activity_srcStats"
  },
  activity_srcStats_caloriesPerHour: {
    graphPattern: "?activity_srcStats activo:caloriesPerHour ?activity_srcStats_caloriesPerHour .",
    requiredVariable: "activity_srcStats"
  },

  activity_srcStats_scores: {
    graphPattern: "?activity_srcStats activo:hasScores ?activity_srcStats_scores .",
    requiredVariable: "activity_srcStats",
    ignore: true
  },
  activity_srcStats_scores_stress_hrss: {
    graphPattern: "?activity_srcStats_scores activo:heartRateStressScore ?activity_srcStats_scores_stress_hrss .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_hrssPerHour: {
    graphPattern:
      "?activity_srcStats_scores activo:heartRateStressScorePerHour ?activity_srcStats_scores_stress_hrssPerHour .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_trimp: {
    graphPattern: "?activity_srcStats_scores activo:trainingImpulse ?activity_srcStats_scores_stress_trimp .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_trimpPerHour: {
    graphPattern:
      "?activity_srcStats_scores activo:trainingImpulsePerHour ?activity_srcStats_scores_stress_trimpPerHour .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_rss: {
    graphPattern: "?activity_srcStats_scores activo:runningStressScore ?activity_srcStats_scores_stress_rss .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_rssPerHour: {
    graphPattern:
      "?activity_srcStats_scores activo:runningStressScorePerHour ?activity_srcStats_scores_stress_rssPerHour .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_sss: {
    graphPattern: "?activity_srcStats_scores activo:swimStressScore ?activity_srcStats_scores_stress_sss .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_sssPerHour: {
    graphPattern:
      "?activity_srcStats_scores activo:swimStressScorePerHour ?activity_srcStats_scores_stress_sssPerHour .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_pss: {
    graphPattern: "?activity_srcStats_scores activo:powerStressScore ?activity_srcStats_scores_stress_pss .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_pssPerHour: {
    graphPattern:
      "?activity_srcStats_scores activo:powerStressScorePerHour ?activity_srcStats_scores_stress_pssPerHour .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_trainingEffect_aerobic: {
    graphPattern:
      "?activity_srcStats_scores activo:aerobicTrainingEffect ?activity_srcStats_scores_stress_trainingEffect_aerobic .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_trainingEffect_anaerobic: {
    graphPattern:
      "?activity_srcStats_scores activo:anaerobicTrainingEffect ?activity_srcStats_scores_stress_trainingEffect_anaerobic .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_efficiency: {
    graphPattern: "?activity_srcStats_scores activo:efficiency ?activity_srcStats_scores_efficiency .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_powerHr: {
    graphPattern: "?activity_srcStats_scores activo:averagePowerHeartRateRatio ?activity_srcStats_scores_powerHr .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_runningRating: {
    graphPattern: "?activity_srcStats_scores activo:runningRating ?activity_srcStats_scores_runningRating .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_swolf_25: {
    graphPattern: "?activity_srcStats_scores activo:swolf25 ?activity_srcStats_scores_swolf_25 .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_swolf_50: {
    graphPattern: "?activity_srcStats_scores activo:swolf50 ?activity_srcStats_scores_swolf_50 .",
    requiredVariable: "activity_srcStats_scores"
  },

  activity_srcStats_speed: {
    graphPattern: "?activity_srcStats activo:hasSpeedStats ?activity_srcStats_speed .",
    requiredVariable: "activity_srcStats",
    ignore: true
  },
  activity_srcStats_speed_avg: {
    graphPattern: "?activity_srcStats_speed activo:average ?activity_srcStats_speed_avg .",
    requiredVariable: "activity_srcStats_speed"
  },
  activity_srcStats_speed_max: {
    graphPattern: "?activity_srcStats_speed activo:max ?activity_srcStats_speed_max .",
    requiredVariable: "activity_srcStats_speed"
  },
  activity_srcStats_speed_lowQ: {
    graphPattern: "?activity_srcStats_speed activo:lowQ ?activity_srcStats_speed_lowQ .",
    requiredVariable: "activity_srcStats_speed"
  },
  activity_srcStats_speed_upperQ: {
    graphPattern: "?activity_srcStats_speed activo:upperQ ?activity_srcStats_speed_upperQ .",
    requiredVariable: "activity_srcStats_speed"
  },
  activity_srcStats_speed_median: {
    graphPattern: "?activity_srcStats_speed activo:median ?activity_srcStats_speed_median .",
    requiredVariable: "activity_srcStats_speed"
  },
  activity_srcStats_speed_stdDev: {
    graphPattern: "?activity_srcStats_speed activo:stdDev ?activity_srcStats_speed_stdDev .",
    requiredVariable: "activity_srcStats_speed"
  },
  activity_srcStats_speed_best20min: {
    graphPattern:
      "?activity_srcStats_speed activo:hasPeak ?activity_srcStats_speed_peaks ." +
      "?activity_srcStats_speed_peaks activo:peakDuration 1200 ." +
      "?activity_srcStats_speed_peaks activo:peakValue ?activity_srcStats_speed_best20min .",
    requiredVariable: "activity_srcStats_speed"
  },

  activity_srcStats_pace: {
    graphPattern: "?activity_srcStats activo:hasPaceStats ?activity_srcStats_pace .",
    requiredVariable: "activity_srcStats",
    ignore: true
  },
  activity_srcStats_pace_avg: {
    graphPattern: "?activity_srcStats_pace activo:average ?activity_srcStats_pace_avg .",
    requiredVariable: "activity_srcStats_pace"
  },
  activity_srcStats_pace_max: {
    graphPattern: "?activity_srcStats_pace activo:max ?activity_srcStats_pace_max .",
    requiredVariable: "activity_srcStats_pace"
  },
  activity_srcStats_pace_lowQ: {
    graphPattern: "?activity_srcStats_pace activo:lowQ ?activity_srcStats_pace_lowQ .",
    requiredVariable: "activity_srcStats_pace"
  },
  activity_srcStats_pace_upperQ: {
    graphPattern: "?activity_srcStats_pace activo:upperQ ?activity_srcStats_pace_upperQ .",
    requiredVariable: "activity_srcStats_pace"
  },
  activity_srcStats_pace_median: {
    graphPattern: "?activity_srcStats_pace activo:median ?activity_srcStats_pace_median .",
    requiredVariable: "activity_srcStats_pace"
  },
  activity_srcStats_pace_stdDev: {
    graphPattern: "?activity_srcStats_pace activo:stdDev ?activity_srcStats_pace_stdDev .",
    requiredVariable: "activity_srcStats_pace"
  },
  activity_srcStats_pace_gapAvg: {
    graphPattern: "?activity_srcStats_pace activo:gradeAdjustedPaceAverage ?activity_srcStats_pace_gapAvg .",
    requiredVariable: "activity_srcStats_pace"
  },
  activity_srcStats_pace_best20min: {
    graphPattern:
      "?activity_srcStats_pace activo:hasPeak ?activity_srcStats_pace_peaks ." +
      "?activity_srcStats_pace_peaks activo:peakDuration 1200 ." +
      "?activity_srcStats_pace_peaks activo:peakValue ?activity_srcStats_pace_best20min .",
    requiredVariable: "activity_srcStats_pace"
  },

  activity_srcStats_power: {
    graphPattern: "?activity_srcStats activo:hasPowerStats ?activity_srcStats_power .",
    requiredVariable: "activity_srcStats",
    ignore: true
  },
  activity_srcStats_power_avg: {
    graphPattern: "?activity_srcStats_power activo:average ?activity_srcStats_power_avg .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_max: {
    graphPattern: "?activity_srcStats_power activo:max ?activity_srcStats_power_max .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_lowQ: {
    graphPattern: "?activity_srcStats_power activo:lowQ ?activity_srcStats_power_lowQ .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_upperQ: {
    graphPattern: "?activity_srcStats_power activo:upperQ ?activity_srcStats_power_upperQ .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_median: {
    graphPattern: "?activity_srcStats_power activo:median ?activity_srcStats_power_median .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_stdDev: {
    graphPattern: "?activity_srcStats_power activo:stdDev ?activity_srcStats_power_stdDev .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_best20min: {
    graphPattern:
      "?activity_srcStats_power activo:hasPeak ?activity_srcStats_power_peaks ." +
      "?activity_srcStats_power_peaks activo:peakDuration 1200 ." +
      "?activity_srcStats_power_peaks activo:peakValue ?activity_srcStats_power_best20min .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_avgKg: {
    graphPattern: "?activity_srcStats_power activo:powerToWeightRatio ?activity_srcStats_power_avgKg .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_weighted: {
    graphPattern: "?activity_srcStats_power activo:normalizedPowerAverage ?activity_srcStats_power_weighted .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_weightedKg: {
    graphPattern: "?activity_srcStats_power activo:normalizedPowerToWeightRatio ?activity_srcStats_power_weightedKg .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_work: {
    graphPattern: "?activity_srcStats_power activo:work ?activity_srcStats_power_work .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_variabilityIndex: {
    graphPattern: "?activity_srcStats_power activo:variabilityIndex ?activity_srcStats_power_variabilityIndex .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_intensityFactor: {
    graphPattern: "?activity_srcStats_power activo:intensityFactor ?activity_srcStats_power_intensityFactor .",
    requiredVariable: "activity_srcStats_power"
  },

  activity_srcStats_heartRate: {
    graphPattern: "?activity_srcStats activo:hasHeartRateStats ?activity_srcStats_heartRate .",
    requiredVariable: "activity_srcStats",
    ignore: true
  },
  activity_srcStats_heartRate_avg: {
    graphPattern: "?activity_srcStats_heartRate activo:average ?activity_srcStats_heartRate_avg .",
    requiredVariable: "activity_srcStats_heartRate"
  },
  activity_srcStats_heartRate_max: {
    graphPattern: "?activity_srcStats_heartRate activo:max ?activity_srcStats_heartRate_max .",
    requiredVariable: "activity_srcStats_heartRate"
  },
  activity_srcStats_heartRate_lowQ: {
    graphPattern: "?activity_srcStats_heartRate activo:lowQ ?activity_srcStats_heartRate_lowQ .",
    requiredVariable: "activity_srcStats_heartRate"
  },
  activity_srcStats_heartRate_upperQ: {
    graphPattern: "?activity_srcStats_heartRate activo:upperQ ?activity_srcStats_heartRate_upperQ .",
    requiredVariable: "activity_srcStats_heartRate"
  },
  activity_srcStats_heartRate_median: {
    graphPattern: "?activity_srcStats_heartRate activo:median ?activity_srcStats_heartRate_median .",
    requiredVariable: "activity_srcStats_heartRate"
  },
  activity_srcStats_heartRate_stdDev: {
    graphPattern: "?activity_srcStats_heartRate activo:stdDev ?activity_srcStats_heartRate_stdDev .",
    requiredVariable: "activity_srcStats_heartRate"
  },
  activity_srcStats_heartRate_best20min: {
    graphPattern:
      "?activity_srcStats_heartRate activo:hasPeak ?activity_srcStats_heartRate_peaks_best20min ." +
      "?activity_srcStats_heartRate_peaks_best20min activo:peakDuration 1200 ." +
      "?activity_srcStats_heartRate_peaks_best20min activo:peakValue ?activity_srcStats_heartRate_best20min .",
    requiredVariable: "activity_srcStats_heartRate"
  },
  activity_srcStats_heartRate_best60min: {
    graphPattern:
      "?activity_srcStats_heartRate activo:hasPeak ?activity_srcStats_heartRate_peak_best60min ." +
      "?activity_srcStats_heartRate_peak_best60min activo:peakDuration 3600 ." +
      "?activity_srcStats_heartRate_peak_best60min activo:peakValue ?activity_srcStats_heartRate_best60min .",
    requiredVariable: "activity_srcStats_heartRate"
  },
  activity_srcStats_heartRate_avgReserve: {
    graphPattern: "?activity_srcStats_heartRate activo:averageReserve ?activity_srcStats_heartRate_avgReserve .",
    requiredVariable: "activity_srcStats_heartRate"
  },
  activity_srcStats_heartRate_maxReserve: {
    graphPattern: "?activity_srcStats_heartRate activo:maxReserve ?activity_srcStats_heartRate_maxReserve .",
    requiredVariable: "activity_srcStats_heartRate"
  },

  activity_srcStats_cadence: {
    graphPattern: "?activity_srcStats activo:hasCadenceStats ?activity_srcStats_cadence .",
    requiredVariable: "activity_srcStats",
    ignore: true
  },
  activity_srcStats_cadence_avg: {
    graphPattern: "?activity_srcStats_cadence activo:average ?activity_srcStats_cadence_avg .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_max: {
    graphPattern: "?activity_srcStats_cadence activo:max ?activity_srcStats_cadence_max .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_lowQ: {
    graphPattern: "?activity_srcStats_cadence activo:lowQ ?activity_srcStats_cadence_lowQ .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_upperQ: {
    graphPattern: "?activity_srcStats_cadence activo:upperQ ?activity_srcStats_cadence_upperQ .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_median: {
    graphPattern: "?activity_srcStats_cadence activo:median ?activity_srcStats_cadence_median .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_stdDev: {
    graphPattern: "?activity_srcStats_cadence activo:stdDev ?activity_srcStats_cadence_stdDev .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_avgActive: {
    graphPattern: "?activity_srcStats_cadence activo:averageActive ?activity_srcStats_cadence_avgActive .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_activeRatio: {
    graphPattern: "?activity_srcStats_cadence activo:activeRatio ?activity_srcStats_cadence_activeRatio .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_activeTime: {
    graphPattern: "?activity_srcStats_cadence activo:activeTime ?activity_srcStats_cadence_activeTime .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_cycles: {
    graphPattern: "?activity_srcStats_cadence activo:cycles ?activity_srcStats_cadence_cycles .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_distPerCycle: {
    graphPattern: "?activity_srcStats_cadence activo:distancePerCycle ?activity_srcStats_cadence_distPerCycle .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_slope_up: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:uphill ?activity_srcStats_cadence_slope_up .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },
  activity_srcStats_cadence_slope_flat: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:flat ?activity_srcStats_cadence_slope_flat .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },
  activity_srcStats_cadence_slope_down: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:downhill ?activity_srcStats_cadence_slope_down .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },
  activity_srcStats_cadence_slope_total: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:total ?activity_srcStats_cadence_slope_total .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },

  activity_srcStats_grade: {
    graphPattern: "?activity_srcStats activo:hasGradeStats ?activity_srcStats_grade .",
    requiredVariable: "activity_srcStats",
    ignore: true
  },
  activity_srcStats_grade_avg: {
    graphPattern: "?activity_srcStats_grade activo:average ?activity_srcStats_grade_avg .",
    requiredVariable: "activity_srcStats_grade"
  },
  activity_srcStats_grade_max: {
    graphPattern: "?activity_srcStats_grade activo:max ?activity_srcStats_grade_max .",
    requiredVariable: "activity_srcStats_grade"
  },
  activity_srcStats_grade_min: {
    graphPattern: "?activity_srcStats_grade activo:min ?activity_srcStats_grade_min .",
    requiredVariable: "activity_srcStats_grade"
  },
  activity_srcStats_grade_lowQ: {
    graphPattern: "?activity_srcStats_grade activo:lowQ ?activity_srcStats_grade_lowQ .",
    requiredVariable: "activity_srcStats_grade"
  },
  activity_srcStats_grade_upperQ: {
    graphPattern: "?activity_srcStats_grade activo:upperQ ?activity_srcStats_grade_upperQ .",
    requiredVariable: "activity_srcStats_grade"
  },
  activity_srcStats_grade_median: {
    graphPattern: "?activity_srcStats_grade activo:median ?activity_srcStats_grade_median .",
    requiredVariable: "activity_srcStats_grade"
  },
  activity_srcStats_grade_stdDev: {
    graphPattern: "?activity_srcStats_grade activo:stdDev ?activity_srcStats_grade_stdDev .",
    requiredVariable: "activity_srcStats_grade"
  },
  activity_srcStats_grade_slopeTime: {
    graphPattern: "?activity_srcStats_grade activo:hasSlopeTime ?activity_srcStats_grade_slopeTime .",
    requiredVariable: "activity_srcStats_grade",
    ignore: true
  },
  activity_srcStats_grade_slopeTime_up: {
    graphPattern: "?activity_srcStats_grade_slopeTime activo:uphill ?activity_srcStats_grade_slopeTime_up .",
    requiredVariable: "activity_srcStats_grade_slopeTime"
  },
  activity_srcStats_grade_slopeTime_flat: {
    graphPattern: "?activity_srcStats_grade_slopeTime activo:flat ?activity_srcStats_grade_slopeTime_flat .",
    requiredVariable: "activity_srcStats_grade_slopeTime"
  },
  activity_srcStats_grade_slopeTime_down: {
    graphPattern: "?activity_srcStats_grade_slopeTime activo:downhill ?activity_srcStats_grade_slopeTime_down .",
    requiredVariable: "activity_srcStats_grade_slopeTime"
  },
  activity_srcStats_grade_slopeTime_total: {
    graphPattern: "?activity_srcStats_grade_slopeTime activo:total ?activity_srcStats_grade_slopeTime_total .",
    requiredVariable: "activity_srcStats_grade_slopeTime"
  },
  activity_srcStats_grade_slopeSpeed: {
    graphPattern: "?activity_srcStats_grade activo:hasSlopeSpeed ?activity_srcStats_grade_slopeSpeed .",
    requiredVariable: "activity_srcStats_grade",
    ignore: true
  },
  activity_srcStats_grade_slopeSpeed_up: {
    graphPattern: "?activity_srcStats_grade_slopeSpeed activo:uphill ?activity_srcStats_grade_slopeSpeed_up .",
    requiredVariable: "activity_srcStats_grade_slopeSpeed"
  },
  activity_srcStats_grade_slopeSpeed_flat: {
    graphPattern: "?activity_srcStats_grade_slopeSpeed activo:flat ?activity_srcStats_grade_slopeSpeed_flat .",
    requiredVariable: "activity_srcStats_grade_slopeSpeed"
  },
  activity_srcStats_grade_slopeSpeed_down: {
    graphPattern: "?activity_srcStats_grade_slopeSpeed activo:downhill ?activity_srcStats_grade_slopeSpeed_down .",
    requiredVariable: "activity_srcStats_grade_slopeSpeed"
  },
  activity_srcStats_grade_slopeSpeed_total: {
    graphPattern: "?activity_srcStats_grade_slopeSpeed activo:total ?activity_srcStats_grade_slopeSpeed_total .",
    requiredVariable: "activity_srcStats_grade_slopeSpeed"
  },
  activity_srcStats_grade_slopePace: {
    graphPattern: "?activity_srcStats_grade activo:hasSlopePace ?activity_srcStats_grade_slopePace .",
    requiredVariable: "activity_srcStats_grade",
    ignore: true
  },
  activity_srcStats_grade_slopePace_up: {
    graphPattern: "?activity_srcStats_grade_slopePace activo:uphill ?activity_srcStats_grade_slopePace_up .",
    requiredVariable: "activity_srcStats_grade_slopePace"
  },
  activity_srcStats_grade_slopePace_flat: {
    graphPattern: "?activity_srcStats_grade_slopePace activo:flat ?activity_srcStats_grade_slopePace_flat .",
    requiredVariable: "activity_srcStats_grade_slopePace"
  },
  activity_srcStats_grade_slopePace_down: {
    graphPattern: "?activity_srcStats_grade_slopePace activo:downhill ?activity_srcStats_grade_slopePace_down .",
    requiredVariable: "activity_srcStats_grade_slopePace"
  },
  activity_srcStats_grade_slopePace_total: {
    graphPattern: "?activity_srcStats_grade_slopePace activo:total ?activity_srcStats_grade_slopePace_total .",
    requiredVariable: "activity_srcStats_grade_slopePace"
  },
  activity_srcStats_grade_slopeDistance: {
    graphPattern: "?activity_srcStats_grade activo:hasSlopeDistance ?activity_srcStats_grade_slopeDistance .",
    requiredVariable: "activity_srcStats_grade",
    ignore: true
  },
  activity_srcStats_grade_slopeDistance_up: {
    graphPattern: "?activity_srcStats_grade_slopeDistance activo:uphill ?activity_srcStats_grade_slopeDistance_up .",
    requiredVariable: "activity_srcStats_grade_slopeDistance"
  },
  activity_srcStats_grade_slopeDistance_flat: {
    graphPattern: "?activity_srcStats_grade_slopeDistance activo:flat ?activity_srcStats_grade_slopeDistance_flat .",
    requiredVariable: "activity_srcStats_grade_slopeDistance"
  },
  activity_srcStats_grade_slopeDistance_down: {
    graphPattern:
      "?activity_srcStats_grade_slopeDistance activo:downhill ?activity_srcStats_grade_slopeDistance_down .",
    requiredVariable: "activity_srcStats_grade_slopeDistance"
  },
  activity_srcStats_grade_slopeDistance_total: {
    graphPattern: "?activity_srcStats_grade_slopeDistance activo:total ?activity_srcStats_grade_slopeDistance_total .",
    requiredVariable: "activity_srcStats_grade_slopeDistance"
  },
  activity_srcStats_grade_slopeCadence: {
    graphPattern: "?activity_srcStats_grade activo:hasSlopeCadence ?activity_srcStats_grade_slopeCadence .",
    requiredVariable: "activity_srcStats_grade",
    ignore: true
  },
  activity_srcStats_grade_slopeCadence_up: {
    graphPattern: "?activity_srcStats_grade_slopeCadence activo:uphill ?activity_srcStats_grade_slopeCadence_up .",
    requiredVariable: "activity_srcStats_grade_slopeCadence"
  },
  activity_srcStats_grade_slopeCadence_flat: {
    graphPattern: "?activity_srcStats_grade_slopeCadence activo:flat ?activity_srcStats_grade_slopeCadence_flat .",
    requiredVariable: "activity_srcStats_grade_slopeCadence"
  },
  activity_srcStats_grade_slopeCadence_down: {
    graphPattern: "?activity_srcStats_grade_slopeCadence activo:downhill ?activity_srcStats_grade_slopeCadence_down .",
    requiredVariable: "activity_srcStats_grade_slopeCadence"
  },
  activity_srcStats_grade_slopeCadence_total: {
    graphPattern: "?activity_srcStats_grade_slopeCadence activo:total ?activity_srcStats_grade_slopeCadence_total .",
    requiredVariable: "activity_srcStats_grade_slopeCadence"
  },
  activity_srcStats_grade_slopeProfile: {
    graphPattern:
      "?activity_srcStats_grade activo:hasSlopeProfile ?activity_srcStats_grade_slopeProfileIri ." +
      'BIND(IF(?activity_srcStats_grade_slopeProfileIri = activo:HillyProfile, "HILLY", ' +
      'IF(?activity_srcStats_grade_slopeProfileIri = activo:FlatProfile, "FLAT", "")) AS ?activity_srcStats_grade_slopeProfile) .',
    requiredVariable: "activity_srcStats_grade"
  },

  activity_srcStats_elevation: {
    graphPattern: "?activity_srcStats activo:hasElevationStats ?activity_srcStats_elevation .",
    requiredVariable: "activity_srcStats",
    ignore: true
  },
  activity_srcStats_elevation_avg: {
    graphPattern: "?activity_srcStats_elevation activo:average ?activity_srcStats_elevation_avg .",
    requiredVariable: "activity_srcStats_elevation"
  },
  activity_srcStats_elevation_max: {
    graphPattern: "?activity_srcStats_elevation activo:max ?activity_srcStats_elevation_max .",
    requiredVariable: "activity_srcStats_elevation"
  },
  activity_srcStats_elevation_min: {
    graphPattern: "?activity_srcStats_elevation activo:min ?activity_srcStats_elevation_min .",
    requiredVariable: "activity_srcStats_elevation"
  },
  activity_srcStats_elevation_lowQ: {
    graphPattern: "?activity_srcStats_elevation activo:lowQ ?activity_srcStats_elevation_lowQ .",
    requiredVariable: "activity_srcStats_elevation"
  },
  activity_srcStats_elevation_upperQ: {
    graphPattern: "?activity_srcStats_elevation activo:upperQ ?activity_srcStats_elevation_upperQ .",
    requiredVariable: "activity_srcStats_elevation"
  },
  activity_srcStats_elevation_median: {
    graphPattern: "?activity_srcStats_elevation activo:median ?activity_srcStats_elevation_median .",
    requiredVariable: "activity_srcStats_elevation"
  },
  activity_srcStats_elevation_stdDev: {
    graphPattern: "?activity_srcStats_elevation activo:stdDev ?activity_srcStats_elevation_stdDev .",
    requiredVariable: "activity_srcStats_elevation"
  },
  activity_srcStats_elevation_ascent: {
    graphPattern: "?activity_srcStats_elevation activo:ascent ?activity_srcStats_elevation_ascent .",
    requiredVariable: "activity_srcStats_elevation"
  },
  activity_srcStats_elevation_descent: {
    graphPattern: "?activity_srcStats_elevation activo:descent ?activity_srcStats_elevation_descent .",
    requiredVariable: "activity_srcStats_elevation"
  },
  activity_srcStats_elevation_ascentSpeed: {
    graphPattern: "?activity_srcStats_elevation activo:ascentSpeed ?activity_srcStats_elevation_ascentSpeed .",
    requiredVariable: "activity_srcStats_elevation"
  },

  activity_srcStats_dynamics_cycling: {
    graphPattern:
      "?activity_srcStats activo:hasDynamicsStats ?activity_srcStats_dynamics_cycling .\n" +
      "?activity_srcStats_dynamics_cycling a activo:CyclingDynamicsStats .",
    requiredVariable: "activity_srcStats",
    ignore: true
  },
  activity_srcStats_dynamics_cycling_standingTime: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling activo:standingTime ?activity_srcStats_dynamics_cycling_standingTime .",
    requiredVariable: "activity_srcStats_dynamics_cycling"
  },
  activity_srcStats_dynamics_cycling_seatedTime: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling activo:seatedTime ?activity_srcStats_dynamics_cycling_seatedTime .",
    requiredVariable: "activity_srcStats_dynamics_cycling"
  },
  activity_srcStats_dynamics_cycling_balance: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling activo:hasBalance ?activity_srcStats_dynamics_cycling_balance .\n" +
      "?activity_srcStats_dynamics_cycling_balance a activo:LeftRightPercent .",
    requiredVariable: "activity_srcStats_dynamics_cycling",
    ignore: true
  },
  activity_srcStats_dynamics_cycling_balance_left: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling_balance activo:left ?activity_srcStats_dynamics_cycling_balance_left .",
    requiredVariable: "activity_srcStats_dynamics_cycling_balance"
  },
  activity_srcStats_dynamics_cycling_balance_right: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling_balance activo:right ?activity_srcStats_dynamics_cycling_balance_right .",
    requiredVariable: "activity_srcStats_dynamics_cycling_balance"
  },
  activity_srcStats_dynamics_cycling_pedalSmoothness: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling activo:hasPedalSmoothness ?activity_srcStats_dynamics_cycling_pedalSmoothness .\n" +
      "?activity_srcStats_dynamics_cycling_pedalSmoothness a activo:LeftRightPercent .",
    requiredVariable: "activity_srcStats_dynamics_cycling",
    ignore: true
  },
  activity_srcStats_dynamics_cycling_pedalSmoothness_left: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling_pedalSmoothness activo:left ?activity_srcStats_dynamics_cycling_pedalSmoothness_left .",
    requiredVariable: "activity_srcStats_dynamics_cycling_pedalSmoothness"
  },
  activity_srcStats_dynamics_cycling_pedalSmoothness_right: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling_pedalSmoothness activo:right ?activity_srcStats_dynamics_cycling_pedalSmoothness_right .",
    requiredVariable: "activity_srcStats_dynamics_cycling_pedalSmoothness"
  },
  activity_srcStats_dynamics_cycling_torqueEffectiveness: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling activo:hasTorqueEffectiveness ?activity_srcStats_dynamics_cycling_torqueEffectiveness .\n" +
      "?activity_srcStats_dynamics_cycling_torqueEffectiveness a activo:LeftRightPercent .",
    requiredVariable: "activity_srcStats_dynamics_cycling",
    ignore: true
  },
  activity_srcStats_dynamics_cycling_torqueEffectiveness_left: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling_torqueEffectiveness activo:left ?activity_srcStats_dynamics_cycling_torqueEffectiveness_left .",
    requiredVariable: "activity_srcStats_dynamics_cycling_torqueEffectiveness"
  },
  activity_srcStats_dynamics_cycling_torqueEffectiveness_right: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling_torqueEffectiveness activo:right ?activity_srcStats_dynamics_cycling_torqueEffectiveness_right .",
    requiredVariable: "activity_srcStats_dynamics_cycling_torqueEffectiveness"
  },
  activity_srcStats_dynamics_running: {
    graphPattern:
      "?activity_srcStats activo:hasDynamicsStats ?activity_srcStats_dynamics_running .\n" +
      "?activity_srcStats_dynamics_running a activo:RunningDynamicsStats .",
    requiredVariable: "activity_srcStats",
    ignore: true
  },
  activity_srcStats_dynamics_running_verticalOscillation: {
    graphPattern:
      "?activity_srcStats_dynamics_running activo:verticalOscillation ?activity_srcStats_dynamics_running_verticalOscillation .",
    requiredVariable: "activity_srcStats_dynamics_running"
  },
  activity_srcStats_dynamics_running_verticalRatio: {
    graphPattern:
      "?activity_srcStats_dynamics_running activo:verticalRatio ?activity_srcStats_dynamics_running_verticalRatio .",
    requiredVariable: "activity_srcStats_dynamics_running"
  },
  activity_srcStats_dynamics_running_stanceTimeBalance: {
    graphPattern:
      "?activity_srcStats_dynamics_running activo:hasGroundContactTimeBalance ?activity_srcStats_dynamics_running_stanceTimeBalance .\n" +
      "?activity_srcStats_dynamics_running_stanceTimeBalance a activo:LeftRightPercent .",
    requiredVariable: "activity_srcStats_dynamics_running",
    ignore: true
  },
  activity_srcStats_dynamics_running_stanceTimeBalance_left: {
    graphPattern:
      "?activity_srcStats_dynamics_running_stanceTimeBalance activo:left ?activity_srcStats_dynamics_running_stanceTimeBalance_left .",
    requiredVariable: "activity_srcStats_dynamics_running_stanceTimeBalance"
  },
  activity_srcStats_dynamics_running_stanceTimeBalance_right: {
    graphPattern:
      "?activity_srcStats_dynamics_running_stanceTimeBalance activo:right ?activity_srcStats_dynamics_running_stanceTimeBalance_right .",
    requiredVariable: "activity_srcStats_dynamics_running_stanceTimeBalance"
  },
  activity_srcStats_dynamics_running_stanceTime: {
    graphPattern:
      "?activity_srcStats_dynamics_running activo:groundContactTime ?activity_srcStats_dynamics_running_stanceTime .",
    requiredVariable: "activity_srcStats_dynamics_running"
  },
  activity_srcStats_dynamics_running_avgStrideLength: {
    graphPattern:
      "?activity_srcStats_dynamics_running activo:averageStrideLength ?activity_srcStats_dynamics_running_avgStrideLength .",
    requiredVariable: "activity_srcStats_dynamics_running"
  },

  // normal stats
  activity_stats: {
    graphPattern: "?activity activo:hasStats ?activity_stats .",
    requiredVariable: "activity",
    ignore: true,
    required: true
  },
  activity_stats_distance: {
    graphPattern: "?activity_stats activo:distance ?activity_stats_distance .",
    requiredVariable: "activity_stats"
  },
  activity_stats_elevationGain: {
    graphPattern: "?activity_stats_elevation activo:ascent ?activity_stats_elevationGain .",
    requiredVariable: "activity_stats_elevation"
  },
  activity_stats_elapsedTime: {
    graphPattern: "?activity_stats activo:elapsedTime ?activity_stats_elapsedTime .",
    requiredVariable: "activity_stats"
  },
  activity_stats_movingTime: {
    graphPattern: "?activity_stats activo:movingTime ?activity_stats_movingTime .",
    requiredVariable: "activity_stats"
  },
  activity_stats_pauseTime: {
    graphPattern: "?activity_stats activo:pauseTime ?activity_stats_pauseTime .",
    requiredVariable: "activity_stats"
  },
  activity_stats_moveRatio: {
    graphPattern: "?activity_stats activo:moveRatio ?activity_stats_moveRatio .",
    requiredVariable: "activity_stats"
  },
  activity_stats_calories: {
    graphPattern: "?activity_stats activo:calories ?activity_stats_calories .",
    requiredVariable: "activity_stats"
  },
  activity_stats_caloriesPerHour: {
    graphPattern: "?activity_stats activo:caloriesPerHour ?activity_stats_caloriesPerHour .",
    requiredVariable: "activity_stats"
  },

  activity_stats_scores: {
    graphPattern: "?activity_stats activo:hasScores ?activity_stats_scores .",
    requiredVariable: "activity_stats",
    ignore: true
  },
  activity_stats_scores_stress_hrss: {
    graphPattern: "?activity_stats_scores activo:heartRateStressScore ?activity_stats_scores_stress_hrss .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_hrssPerHour: {
    graphPattern:
      "?activity_stats_scores activo:heartRateStressScorePerHour ?activity_stats_scores_stress_hrssPerHour .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_trimp: {
    graphPattern: "?activity_stats_scores activo:trainingImpulse ?activity_stats_scores_stress_trimp .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_trimpPerHour: {
    graphPattern: "?activity_stats_scores activo:trainingImpulsePerHour ?activity_stats_scores_stress_trimpPerHour .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_rss: {
    graphPattern: "?activity_stats_scores activo:runningStressScore ?activity_stats_scores_stress_rss .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_rssPerHour: {
    graphPattern: "?activity_stats_scores activo:runningStressScorePerHour ?activity_stats_scores_stress_rssPerHour .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_sss: {
    graphPattern: "?activity_stats_scores activo:swimStressScore ?activity_stats_scores_stress_sss .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_sssPerHour: {
    graphPattern: "?activity_stats_scores activo:swimStressScorePerHour ?activity_stats_scores_stress_sssPerHour .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_pss: {
    graphPattern: "?activity_stats_scores activo:powerStressScore ?activity_stats_scores_stress_pss .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_pssPerHour: {
    graphPattern: "?activity_stats_scores activo:powerStressScorePerHour ?activity_stats_scores_stress_pssPerHour .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_trainingEffect_aerobic: {
    graphPattern:
      "?activity_stats_scores activo:aerobicTrainingEffect ?activity_stats_scores_stress_trainingEffect_aerobic .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_trainingEffect_anaerobic: {
    graphPattern:
      "?activity_stats_scores activo:anaerobicTrainingEffect ?activity_stats_scores_stress_trainingEffect_anaerobic .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_efficiency: {
    graphPattern: "?activity_stats_scores activo:efficiency ?activity_stats_scores_efficiency .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_powerHr: {
    graphPattern: "?activity_stats_scores activo:averagePowerHeartRateRatio ?activity_stats_scores_powerHr .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_runningRating: {
    graphPattern: "?activity_stats_scores activo:runningRating ?activity_stats_scores_runningRating .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_swolf_25: {
    graphPattern: "?activity_stats_scores activo:swolf25 ?activity_stats_scores_swolf_25 .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_swolf_50: {
    graphPattern: "?activity_stats_scores activo:swolf50 ?activity_stats_scores_swolf_50 .",
    requiredVariable: "activity_stats_scores"
  },

  activity_stats_speed: {
    graphPattern: "?activity_stats activo:hasSpeedStats ?activity_stats_speed .",
    requiredVariable: "activity_stats",
    ignore: true
  },
  activity_stats_speed_avg: {
    graphPattern: "?activity_stats_speed activo:average ?activity_stats_speed_avg .",
    requiredVariable: "activity_stats_speed"
  },
  activity_stats_speed_max: {
    graphPattern: "?activity_stats_speed activo:max ?activity_stats_speed_max .",
    requiredVariable: "activity_stats_speed"
  },
  activity_stats_speed_lowQ: {
    graphPattern: "?activity_stats_speed activo:lowQ ?activity_stats_speed_lowQ .",
    requiredVariable: "activity_stats_speed"
  },
  activity_stats_speed_upperQ: {
    graphPattern: "?activity_stats_speed activo:upperQ ?activity_stats_speed_upperQ .",
    requiredVariable: "activity_stats_speed"
  },
  activity_stats_speed_median: {
    graphPattern: "?activity_stats_speed activo:median ?activity_stats_speed_median .",
    requiredVariable: "activity_stats_speed"
  },
  activity_stats_speed_stdDev: {
    graphPattern: "?activity_stats_speed activo:stdDev ?activity_stats_speed_stdDev .",
    requiredVariable: "activity_stats_speed"
  },
  activity_stats_speed_best20min: {
    graphPattern:
      "?activity_stats_speed activo:hasPeak ?activity_stats_speed_peaks ." +
      "?activity_stats_speed_peaks activo:peakDuration 1200 ." +
      "?activity_stats_speed_peaks activo:peakValue ?activity_stats_speed_best20min .",
    requiredVariable: "activity_stats_speed"
  },

  activity_stats_pace: {
    graphPattern: "?activity_stats activo:hasPaceStats ?activity_stats_pace .",
    requiredVariable: "activity_stats",
    ignore: true
  },
  activity_stats_pace_avg: {
    graphPattern: "?activity_stats_pace activo:average ?activity_stats_pace_avg .",
    requiredVariable: "activity_stats_pace"
  },
  activity_stats_pace_max: {
    graphPattern: "?activity_stats_pace activo:max ?activity_stats_pace_max .",
    requiredVariable: "activity_stats_pace"
  },
  activity_stats_pace_lowQ: {
    graphPattern: "?activity_stats_pace activo:lowQ ?activity_stats_pace_lowQ .",
    requiredVariable: "activity_stats_pace"
  },
  activity_stats_pace_upperQ: {
    graphPattern: "?activity_stats_pace activo:upperQ ?activity_stats_pace_upperQ .",
    requiredVariable: "activity_stats_pace"
  },
  activity_stats_pace_median: {
    graphPattern: "?activity_stats_pace activo:median ?activity_stats_pace_median .",
    requiredVariable: "activity_stats_pace"
  },
  activity_stats_pace_stdDev: {
    graphPattern: "?activity_stats_pace activo:stdDev ?activity_stats_pace_stdDev .",
    requiredVariable: "activity_stats_pace"
  },
  activity_stats_pace_gapAvg: {
    graphPattern: "?activity_stats_pace activo:gradeAdjustedPaceAverage ?activity_stats_pace_gapAvg .",
    requiredVariable: "activity_stats_pace"
  },
  activity_stats_pace_best20min: {
    graphPattern:
      "?activity_stats_pace activo:hasPeak ?activity_stats_pace_peaks ." +
      "?activity_stats_pace_peaks activo:peakDuration 1200 ." +
      "?activity_stats_pace_peaks activo:peakValue ?activity_stats_pace_best20min .",
    requiredVariable: "activity_stats_pace"
  },

  activity_stats_power: {
    graphPattern: "?activity_stats activo:hasPowerStats ?activity_stats_power .",
    requiredVariable: "activity_stats",
    ignore: true
  },
  activity_stats_power_avg: {
    graphPattern: "?activity_stats_power activo:average ?activity_stats_power_avg .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_max: {
    graphPattern: "?activity_stats_power activo:max ?activity_stats_power_max .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_lowQ: {
    graphPattern: "?activity_stats_power activo:lowQ ?activity_stats_power_lowQ .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_upperQ: {
    graphPattern: "?activity_stats_power activo:upperQ ?activity_stats_power_upperQ .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_median: {
    graphPattern: "?activity_stats_power activo:median ?activity_stats_power_median .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_stdDev: {
    graphPattern: "?activity_stats_power activo:stdDev ?activity_stats_power_stdDev .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_best20min: {
    graphPattern:
      "?activity_stats_power activo:hasPeak ?activity_stats_power_peaks ." +
      "?activity_stats_power_peaks activo:peakDuration 1200 ." +
      "?activity_stats_power_peaks activo:peakValue ?activity_stats_power_best20min .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_avgKg: {
    graphPattern: "?activity_stats_power activo:powerToWeightRatio ?activity_stats_power_avgKg .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_weighted: {
    graphPattern: "?activity_stats_power activo:normalizedPowerAverage ?activity_stats_power_weighted .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_weightedKg: {
    graphPattern: "?activity_stats_power activo:normalizedPowerToWeightRatio ?activity_stats_power_weightedKg .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_work: {
    graphPattern: "?activity_stats_power activo:work ?activity_stats_power_work .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_variabilityIndex: {
    graphPattern: "?activity_stats_power activo:variabilityIndex ?activity_stats_power_variabilityIndex .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_intensityFactor: {
    graphPattern: "?activity_stats_power activo:intensityFactor ?activity_stats_power_intensityFactor .",
    requiredVariable: "activity_stats_power"
  },

  activity_stats_heartRate: {
    graphPattern: "?activity_stats activo:hasHeartRateStats ?activity_stats_heartRate .",
    requiredVariable: "activity_stats",
    ignore: true
  },
  activity_stats_heartRate_avg: {
    graphPattern: "?activity_stats_heartRate activo:average ?activity_stats_heartRate_avg .",
    requiredVariable: "activity_stats_heartRate"
  },
  activity_stats_heartRate_max: {
    graphPattern: "?activity_stats_heartRate activo:max ?activity_stats_heartRate_max .",
    requiredVariable: "activity_stats_heartRate"
  },
  activity_stats_heartRate_lowQ: {
    graphPattern: "?activity_stats_heartRate activo:lowQ ?activity_stats_heartRate_lowQ .",
    requiredVariable: "activity_stats_heartRate"
  },
  activity_stats_heartRate_upperQ: {
    graphPattern: "?activity_stats_heartRate activo:upperQ ?activity_stats_heartRate_upperQ .",
    requiredVariable: "activity_stats_heartRate"
  },
  activity_stats_heartRate_median: {
    graphPattern: "?activity_stats_heartRate activo:median ?activity_stats_heartRate_median .",
    requiredVariable: "activity_stats_heartRate"
  },
  activity_stats_heartRate_stdDev: {
    graphPattern: "?activity_stats_heartRate activo:stdDev ?activity_stats_heartRate_stdDev .",
    requiredVariable: "activity_stats_heartRate"
  },
  activity_stats_heartRate_best20min: {
    graphPattern:
      "?activity_stats_heartRate activo:hasPeak ?activity_stats_heartRate_peaks_best20min ." +
      "?activity_stats_heartRate_peaks_best20min activo:peakDuration 1200 ." +
      "?activity_stats_heartRate_peaks_best20min activo:peakValue ?activity_stats_heartRate_best20min .",
    requiredVariable: "activity_stats_heartRate"
  },
  activity_stats_heartRate_best60min: {
    graphPattern:
      "?activity_stats_heartRate activo:hasPeak ?activity_stats_heartRate_peak_best60min ." +
      "?activity_stats_heartRate_peak_best60min activo:peakDuration 3600 ." +
      "?activity_stats_heartRate_peak_best60min activo:peakValue ?activity_stats_heartRate_best60min .",
    requiredVariable: "activity_stats_heartRate"
  },
  activity_stats_heartRate_avgReserve: {
    graphPattern: "?activity_stats_heartRate activo:averageReserve ?activity_stats_heartRate_avgReserve .",
    requiredVariable: "activity_stats_heartRate"
  },
  activity_stats_heartRate_maxReserve: {
    graphPattern: "?activity_stats_heartRate activo:maxReserve ?activity_stats_heartRate_maxReserve .",
    requiredVariable: "activity_stats_heartRate"
  },

  activity_stats_cadence: {
    graphPattern: "?activity_stats activo:hasCadenceStats ?activity_stats_cadence .",
    requiredVariable: "activity_stats",
    ignore: true
  },
  activity_stats_cadence_avg: {
    graphPattern: "?activity_stats_cadence activo:average ?activity_stats_cadence_avg .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_max: {
    graphPattern: "?activity_stats_cadence activo:max ?activity_stats_cadence_max .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_lowQ: {
    graphPattern: "?activity_stats_cadence activo:lowQ ?activity_stats_cadence_lowQ .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_upperQ: {
    graphPattern: "?activity_stats_cadence activo:upperQ ?activity_stats_cadence_upperQ .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_median: {
    graphPattern: "?activity_stats_cadence activo:median ?activity_stats_cadence_median .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_stdDev: {
    graphPattern: "?activity_stats_cadence activo:stdDev ?activity_stats_cadence_stdDev .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_avgActive: {
    graphPattern: "?activity_stats_cadence activo:averageActive ?activity_stats_cadence_avgActive .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_activeRatio: {
    graphPattern: "?activity_stats_cadence activo:activeRatio ?activity_stats_cadence_activeRatio .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_activeTime: {
    graphPattern: "?activity_stats_cadence activo:activeTime ?activity_stats_cadence_activeTime .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_cycles: {
    graphPattern: "?activity_stats_cadence activo:cycles ?activity_stats_cadence_cycles .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_distPerCycle: {
    graphPattern: "?activity_stats_cadence activo:distancePerCycle ?activity_stats_cadence_distPerCycle .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_slope_up: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:uphill ?activity_stats_cadence_slope_up .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },
  activity_stats_cadence_slope_flat: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:flat ?activity_stats_cadence_slope_flat .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },
  activity_stats_cadence_slope_down: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:downhill ?activity_stats_cadence_slope_down .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },
  activity_stats_cadence_slope_total: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:total ?activity_stats_cadence_slope_total .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },

  activity_stats_grade: {
    graphPattern: "?activity_stats activo:hasGradeStats ?activity_stats_grade .",
    requiredVariable: "activity_stats",
    ignore: true
  },
  activity_stats_grade_avg: {
    graphPattern: "?activity_stats_grade activo:average ?activity_stats_grade_avg .",
    requiredVariable: "activity_stats_grade"
  },
  activity_stats_grade_max: {
    graphPattern: "?activity_stats_grade activo:max ?activity_stats_grade_max .",
    requiredVariable: "activity_stats_grade"
  },
  activity_stats_grade_min: {
    graphPattern: "?activity_stats_grade activo:min ?activity_stats_grade_min .",
    requiredVariable: "activity_stats_grade"
  },
  activity_stats_grade_lowQ: {
    graphPattern: "?activity_stats_grade activo:lowQ ?activity_stats_grade_lowQ .",
    requiredVariable: "activity_stats_grade"
  },
  activity_stats_grade_upperQ: {
    graphPattern: "?activity_stats_grade activo:upperQ ?activity_stats_grade_upperQ .",
    requiredVariable: "activity_stats_grade"
  },
  activity_stats_grade_median: {
    graphPattern: "?activity_stats_grade activo:median ?activity_stats_grade_median .",
    requiredVariable: "activity_stats_grade"
  },
  activity_stats_grade_stdDev: {
    graphPattern: "?activity_stats_grade activo:stdDev ?activity_stats_grade_stdDev .",
    requiredVariable: "activity_stats_grade"
  },
  activity_stats_grade_slopeTime: {
    graphPattern: "?activity_stats_grade activo:hasSlopeTime ?activity_stats_grade_slopeTime .",
    requiredVariable: "activity_stats_grade",
    ignore: true
  },
  activity_stats_grade_slopeTime_up: {
    graphPattern: "?activity_stats_grade_slopeTime activo:uphill ?activity_stats_grade_slopeTime_up .",
    requiredVariable: "activity_stats_grade_slopeTime"
  },
  activity_stats_grade_slopeTime_flat: {
    graphPattern: "?activity_stats_grade_slopeTime activo:flat ?activity_stats_grade_slopeTime_flat .",
    requiredVariable: "activity_stats_grade_slopeTime"
  },
  activity_stats_grade_slopeTime_down: {
    graphPattern: "?activity_stats_grade_slopeTime activo:downhill ?activity_stats_grade_slopeTime_down .",
    requiredVariable: "activity_stats_grade_slopeTime"
  },
  activity_stats_grade_slopeTime_total: {
    graphPattern: "?activity_stats_grade_slopeTime activo:total ?activity_stats_grade_slopeTime_total .",
    requiredVariable: "activity_stats_grade_slopeTime"
  },
  activity_stats_grade_slopeSpeed: {
    graphPattern: "?activity_stats_grade activo:hasSlopeSpeed ?activity_stats_grade_slopeSpeed .",
    requiredVariable: "activity_stats_grade",
    ignore: true
  },
  activity_stats_grade_slopeSpeed_up: {
    graphPattern: "?activity_stats_grade_slopeSpeed activo:uphill ?activity_stats_grade_slopeSpeed_up .",
    requiredVariable: "activity_stats_grade_slopeSpeed"
  },
  activity_stats_grade_slopeSpeed_flat: {
    graphPattern: "?activity_stats_grade_slopeSpeed activo:flat ?activity_stats_grade_slopeSpeed_flat .",
    requiredVariable: "activity_stats_grade_slopeSpeed"
  },
  activity_stats_grade_slopeSpeed_down: {
    graphPattern: "?activity_stats_grade_slopeSpeed activo:downhill ?activity_stats_grade_slopeSpeed_down .",
    requiredVariable: "activity_stats_grade_slopeSpeed"
  },
  activity_stats_grade_slopeSpeed_total: {
    graphPattern: "?activity_stats_grade_slopeSpeed activo:total ?activity_stats_grade_slopeSpeed_total .",
    requiredVariable: "activity_stats_grade_slopeSpeed"
  },
  activity_stats_grade_slopePace: {
    graphPattern: "?activity_stats_grade activo:hasSlopePace ?activity_stats_grade_slopePace .",
    requiredVariable: "activity_stats_grade",
    ignore: true
  },
  activity_stats_grade_slopePace_up: {
    graphPattern: "?activity_stats_grade_slopePace activo:uphill ?activity_stats_grade_slopePace_up .",
    requiredVariable: "activity_stats_grade_slopePace"
  },
  activity_stats_grade_slopePace_flat: {
    graphPattern: "?activity_stats_grade_slopePace activo:flat ?activity_stats_grade_slopePace_flat .",
    requiredVariable: "activity_stats_grade_slopePace"
  },
  activity_stats_grade_slopePace_down: {
    graphPattern: "?activity_stats_grade_slopePace activo:downhill ?activity_stats_grade_slopePace_down .",
    requiredVariable: "activity_stats_grade_slopePace"
  },
  activity_stats_grade_slopePace_total: {
    graphPattern: "?activity_stats_grade_slopePace activo:total ?activity_stats_grade_slopePace_total .",
    requiredVariable: "activity_stats_grade_slopePace"
  },
  activity_stats_grade_slopeDistance: {
    graphPattern: "?activity_stats_grade activo:hasSlopeDistance ?activity_stats_grade_slopeDistance .",
    requiredVariable: "activity_stats_grade",
    ignore: true
  },
  activity_stats_grade_slopeDistance_up: {
    graphPattern: "?activity_stats_grade_slopeDistance activo:uphill ?activity_stats_grade_slopeDistance_up .",
    requiredVariable: "activity_stats_grade_slopeDistance"
  },
  activity_stats_grade_slopeDistance_flat: {
    graphPattern: "?activity_stats_grade_slopeDistance activo:flat ?activity_stats_grade_slopeDistance_flat .",
    requiredVariable: "activity_stats_grade_slopeDistance"
  },
  activity_stats_grade_slopeDistance_down: {
    graphPattern: "?activity_stats_grade_slopeDistance activo:downhill ?activity_stats_grade_slopeDistance_down .",
    requiredVariable: "activity_stats_grade_slopeDistance"
  },
  activity_stats_grade_slopeDistance_total: {
    graphPattern: "?activity_stats_grade_slopeDistance activo:total ?activity_stats_grade_slopeDistance_total .",
    requiredVariable: "activity_stats_grade_slopeDistance"
  },
  activity_stats_grade_slopeCadence: {
    graphPattern: "?activity_stats_grade activo:hasSlopeCadence ?activity_stats_grade_slopeCadence .",
    requiredVariable: "activity_stats_grade",
    ignore: true
  },
  activity_stats_grade_slopeCadence_up: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:uphill ?activity_stats_grade_slopeCadence_up .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },
  activity_stats_grade_slopeCadence_flat: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:flat ?activity_stats_grade_slopeCadence_flat .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },
  activity_stats_grade_slopeCadence_down: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:downhill ?activity_stats_grade_slopeCadence_down .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },
  activity_stats_grade_slopeCadence_total: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:total ?activity_stats_grade_slopeCadence_total .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },
  activity_stats_grade_slopeProfile: {
    graphPattern:
      "?activity_stats_grade activo:hasSlopeProfile ?activity_stats_grade_slopeProfileIri ." +
      'BIND(IF(?activity_stats_grade_slopeProfileIri = activo:HillyProfile, "HILLY", ' +
      'IF(?activity_stats_grade_slopeProfileIri = activo:FlatProfile, "FLAT", "")) AS ?activity_stats_grade_slopeProfile) .',
    requiredVariable: "activity_stats_grade"
  },

  activity_stats_elevation: {
    graphPattern: "?activity_stats activo:hasElevationStats ?activity_stats_elevation .",
    requiredVariable: "activity_stats",
    ignore: true
  },
  activity_stats_elevation_avg: {
    graphPattern: "?activity_stats_elevation activo:average ?activity_stats_elevation_avg .",
    requiredVariable: "activity_stats_elevation"
  },
  activity_stats_elevation_max: {
    graphPattern: "?activity_stats_elevation activo:max ?activity_stats_elevation_max .",
    requiredVariable: "activity_stats_elevation"
  },
  activity_stats_elevation_min: {
    graphPattern: "?activity_stats_elevation activo:min ?activity_stats_elevation_min .",
    requiredVariable: "activity_stats_elevation"
  },
  activity_stats_elevation_lowQ: {
    graphPattern: "?activity_stats_elevation activo:lowQ ?activity_stats_elevation_lowQ .",
    requiredVariable: "activity_stats_elevation"
  },
  activity_stats_elevation_upperQ: {
    graphPattern: "?activity_stats_elevation activo:upperQ ?activity_stats_elevation_upperQ .",
    requiredVariable: "activity_stats_elevation"
  },
  activity_stats_elevation_median: {
    graphPattern: "?activity_stats_elevation activo:median ?activity_stats_elevation_median .",
    requiredVariable: "activity_stats_elevation"
  },
  activity_stats_elevation_stdDev: {
    graphPattern: "?activity_stats_elevation activo:stdDev ?activity_stats_elevation_stdDev .",
    requiredVariable: "activity_stats_elevation"
  },
  activity_stats_elevation_ascent: {
    graphPattern: "?activity_stats_elevation activo:ascent ?activity_stats_elevation_ascent .",
    requiredVariable: "activity_stats_elevation"
  },
  activity_stats_elevation_descent: {
    graphPattern: "?activity_stats_elevation activo:descent ?activity_stats_elevation_descent .",
    requiredVariable: "activity_stats_elevation"
  },
  activity_stats_elevation_ascentSpeed: {
    graphPattern: "?activity_stats_elevation activo:ascentSpeed ?activity_stats_elevation_ascentSpeed .",
    requiredVariable: "activity_stats_elevation"
  },

  activity_stats_dynamics_cycling: {
    graphPattern:
      "?activity_stats activo:hasDynamicsStats ?activity_stats_dynamics_cycling .\n" +
      "?activity_stats_dynamics_cycling a activo:CyclingDynamicsStats .",
    requiredVariable: "activity_stats",
    ignore: true
  },
  activity_stats_dynamics_cycling_standingTime: {
    graphPattern:
      "?activity_stats_dynamics_cycling activo:standingTime ?activity_stats_dynamics_cycling_standingTime .",
    requiredVariable: "activity_stats_dynamics_cycling"
  },
  activity_stats_dynamics_cycling_seatedTime: {
    graphPattern: "?activity_stats_dynamics_cycling activo:seatedTime ?activity_stats_dynamics_cycling_seatedTime .",
    requiredVariable: "activity_stats_dynamics_cycling"
  },
  activity_stats_dynamics_cycling_balance: {
    graphPattern:
      "?activity_stats_dynamics_cycling activo:hasBalance ?activity_stats_dynamics_cycling_balance .\n" +
      "?activity_stats_dynamics_cycling_balance a activo:LeftRightPercent .",
    requiredVariable: "activity_stats_dynamics_cycling",
    ignore: true
  },
  activity_stats_dynamics_cycling_balance_left: {
    graphPattern:
      "?activity_stats_dynamics_cycling_balance activo:left ?activity_stats_dynamics_cycling_balance_left .",
    requiredVariable: "activity_stats_dynamics_cycling_balance"
  },
  activity_stats_dynamics_cycling_balance_right: {
    graphPattern:
      "?activity_stats_dynamics_cycling_balance activo:right ?activity_stats_dynamics_cycling_balance_right .",
    requiredVariable: "activity_stats_dynamics_cycling_balance"
  },
  activity_stats_dynamics_cycling_pedalSmoothness: {
    graphPattern:
      "?activity_stats_dynamics_cycling activo:hasPedalSmoothness ?activity_stats_dynamics_cycling_pedalSmoothness .\n" +
      "?activity_stats_dynamics_cycling_pedalSmoothness a activo:LeftRightPercent .",
    requiredVariable: "activity_stats_dynamics_cycling",
    ignore: true
  },
  activity_stats_dynamics_cycling_pedalSmoothness_left: {
    graphPattern:
      "?activity_stats_dynamics_cycling_pedalSmoothness activo:left ?activity_stats_dynamics_cycling_pedalSmoothness_left .",
    requiredVariable: "activity_stats_dynamics_cycling_pedalSmoothness"
  },
  activity_stats_dynamics_cycling_pedalSmoothness_right: {
    graphPattern:
      "?activity_stats_dynamics_cycling_pedalSmoothness activo:right ?activity_stats_dynamics_cycling_pedalSmoothness_right .",
    requiredVariable: "activity_stats_dynamics_cycling_pedalSmoothness"
  },
  activity_stats_dynamics_cycling_torqueEffectiveness: {
    graphPattern:
      "?activity_stats_dynamics_cycling activo:hasTorqueEffectiveness ?activity_stats_dynamics_cycling_torqueEffectiveness .\n" +
      "?activity_stats_dynamics_cycling_torqueEffectiveness a activo:LeftRightPercent .",
    requiredVariable: "activity_stats_dynamics_cycling",
    ignore: true
  },
  activity_stats_dynamics_cycling_torqueEffectiveness_left: {
    graphPattern:
      "?activity_stats_dynamics_cycling_torqueEffectiveness activo:left ?activity_stats_dynamics_cycling_torqueEffectiveness_left .",
    requiredVariable: "activity_stats_dynamics_cycling_torqueEffectiveness"
  },
  activity_stats_dynamics_cycling_torqueEffectiveness_right: {
    graphPattern:
      "?activity_stats_dynamics_cycling_torqueEffectiveness activo:right ?activity_stats_dynamics_cycling_torqueEffectiveness_right .",
    requiredVariable: "activity_stats_dynamics_cycling_torqueEffectiveness"
  },
  activity_stats_dynamics_running: {
    graphPattern:
      "?activity_stats activo:hasDynamicsStats ?activity_stats_dynamics_running .\n" +
      "?activity_stats_dynamics_running a activo:RunningDynamicsStats .",
    requiredVariable: "activity_stats",
    ignore: true
  },
  activity_stats_dynamics_running_verticalOscillation: {
    graphPattern:
      "?activity_stats_dynamics_running activo:verticalOscillation ?activity_stats_dynamics_running_verticalOscillation .",
    requiredVariable: "activity_stats_dynamics_running"
  },
  activity_stats_dynamics_running_verticalRatio: {
    graphPattern:
      "?activity_stats_dynamics_running activo:verticalRatio ?activity_stats_dynamics_running_verticalRatio .",
    requiredVariable: "activity_stats_dynamics_running"
  },
  activity_stats_dynamics_running_stanceTimeBalance: {
    graphPattern:
      "?activity_stats_dynamics_running activo:hasGroundContactTimeBalance ?activity_stats_dynamics_running_stanceTimeBalance .\n" +
      "?activity_stats_dynamics_running_stanceTimeBalance a activo:LeftRightPercent .",
    requiredVariable: "activity_stats_dynamics_running",
    ignore: true
  },
  activity_stats_dynamics_running_stanceTimeBalance_left: {
    graphPattern:
      "?activity_stats_dynamics_running_stanceTimeBalance activo:left ?activity_stats_dynamics_running_stanceTimeBalance_left .",
    requiredVariable: "activity_stats_dynamics_running_stanceTimeBalance"
  },
  activity_stats_dynamics_running_stanceTimeBalance_right: {
    graphPattern:
      "?activity_stats_dynamics_running_stanceTimeBalance activo:right ?activity_stats_dynamics_running_stanceTimeBalance_right .",
    requiredVariable: "activity_stats_dynamics_running_stanceTimeBalance"
  },
  activity_stats_dynamics_running_stanceTime: {
    graphPattern:
      "?activity_stats_dynamics_running activo:groundContactTime ?activity_stats_dynamics_running_stanceTime .",
    requiredVariable: "activity_stats_dynamics_running"
  },
  activity_stats_dynamics_running_avgStrideLength: {
    graphPattern:
      "?activity_stats_dynamics_running activo:averageStrideLength ?activity_stats_dynamics_running_avgStrideLength .",
    requiredVariable: "activity_stats_dynamics_running"
  },

  activity_laps: {
    graphPattern: "SELECT (COUNT(?activity_lap) AS ?activity_laps) WHERE { ?activity activo:hasLap ?activity_lap . }",
    requiredVariable: "activity",
    formatValue: (bindings: Bindings) => {
      if (!bindings.has("activity_laps")) {
        return null;
      }
      let laps = [];
      for (let i = 0; i < parseInt(bindings.get("activity_laps").value); i++) {
        laps.push({
          id: i + 1,
          distance: null,
          duration: null,
          startTime: null,
          endTime: null
        });
      }
      return parseInt(bindings.get("activity_laps").value);
    }
  },
  activity_flags: {
    graphPattern:
      "SELECT (COUNT(?activity_flag) AS ?activity_flags) WHERE { ?activity activo:hasFlag ?activity_flag . }",
    requiredVariable: "activity",
    formatValue: (bindings: Bindings) => {
      if (!bindings.has("activity_flags")) {
        return null;
      }
      return [];
    }
  },

  activity_isSwimPool: {
    graphPattern: "?activity activo:isSwimPool ?activity_isSwimPool .",
    requiredVariable: "activity"
  },
  activity_latLngCenter: {
    graphPattern:
      "?activity activo:latCenter ?activity_latCenter .\n" + "?activity activo:lonCenter ?activity_lngCenter .",
    requiredVariable: "activity",
    formatValue: (bindings: Bindings) => {
      if (!bindings.has("activity_latCenter") || !bindings.has("activity_lngCenter")) {
        return null;
      }
      return [
        parseFloat(bindings.get("activity_latCenter").value),
        parseFloat(bindings.get("activity_lngCenter").value)
      ];
    }
  },
  activity_hash: {
    graphPattern: "?activity activo:hash ?activity_hash .",
    requiredVariable: "activity",
    required: true
  },
  activity_settingsLack: {
    graphPattern: "?activity activo:isWithoutAthletePerformance ?activity_settingsLack .",
    requiredVariable: "activity",
    required: true
  },
  activity_creationTime: {
    graphPattern: "?activity prov:generatedAtTime ?activity_creationTime .",
    requiredVariable: "activity",
    required: true
  },
  activity_lastEditTime: {
    graphPattern: "",
    requiredVariable: "activity_creationTime",
    formatValue: (bindings: Bindings) => {
      if (!bindings.has("activity_creationTime")) {
        return null;
      }
      return bindings.get("activity_creationTime").value;
    },
    required: true
  },
  activity_device: {
    graphPattern:
      "?activity_extras_file prov:wasAttributedTo ?activity_deviceAgent ." +
      "?activity_deviceAgent foaf:name ?activity_device .",
    requiredVariable: "activity_extras_file"
  },
  activity_notes: {
    graphPattern: "?activity activo:notes ?activity_notes .",
    requiredVariable: "activity"
  },
  activity_autoDetectedType: {
    graphPattern: "?activity activo:isTypeAutoDetected ?activity_autoDetectedType .",
    requiredVariable: "activity"
  },
  activity_extras_file: {
    graphPattern: "?activity prov:wasDerivedFrom ?activity_extras_file .",
    requiredVariable: "activity",
    ignore: true
  },
  activity_extras_file_path: {
    graphPattern: "?activity_extras_file prov:atLocation ?activity_extras_file_path .",
    requiredVariable: "activity_extras_file"
  },
  activity_extras_file_type: {
    graphPattern: "",
    requiredVariable: "activity_extras_file_path",
    formatValue: (bindings: Bindings) => {
      if (!bindings.has("activity_extras_file_path")) {
        return null;
      }
      const filePath = bindings.get("activity_extras_file_path").value;
      const fileType = filePath.split(".").pop();
      return fileType ? fileType.toLowerCase() : null;
    }
  }
};
