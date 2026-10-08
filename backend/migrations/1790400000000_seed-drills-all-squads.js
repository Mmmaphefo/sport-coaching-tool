exports.up = (pgm) => {
  // Seed drills for any squad missing the standard seed drills
  pgm.sql(`
    INSERT INTO drills (squad_id, name, description, tactical_goal, age_group, duration_minutes, equipment, instructions, phase)
    SELECT s.id, v.name, v.description, v.tactical_goal, v.age_group, v.duration_minutes, v.equipment, v.instructions, v.phase
    FROM squads s
    CROSS JOIN (VALUES
      ('Rondo 4v2', 'Quick passing in a tight space. 4 attackers keep possession against 2 defenders.', 'Possession', 'First Team', 10, '6 cones, 1 ball', 'Set up a 10x10 grid. 4 attackers on the outside, 2 defenders inside. Attackers must complete 10 passes. Defenders try to intercept.', 'Warm-up'),
      ('Dynamic Stretching Circuit', 'Movement-based warm-up covering all major muscle groups.', 'Ball Mastery', 'First Team', 10, 'Cones for stations', 'Set up 5 stations: high knees, butt kicks, lunges with twist, lateral shuffles, carioca. 30 seconds each, 2 rounds.', 'Warm-up'),
      ('Passing Pairs', 'Simple paired passing to warm up feet and communication.', 'Possession', 'U15', 8, '1 ball per pair', 'Pairs spread across the pitch. Pass and move. Start with 2-touch, progress to 1-touch. Call the name of your partner before receiving.', 'Warm-up'),
      ('Through Ball & Finish', 'Practice splitting the defence with timed through balls and clinical finishing.', 'Attacking', 'First Team', 20, 'Cones, 2 goals, balls', 'Set up a channel between two lines of cones. Attacker makes a timed run, midfielder plays a through ball. Attacker finishes 1v1 with the keeper. Rotate roles.', 'Main Activity'),
      ('Zonal Defending Shape', 'Organise the back four to shift and compress space as a unit.', 'Defending', 'First Team', 25, 'Cones, bibs, balls', 'Back four + 2 CMs defend a 30-yard zone. Attackers pass the ball across the front. Defenders must shift together, staying compact. Coach calls directions.', 'Main Activity'),
      ('Corner Delivery & Finishing', 'Practise in-swinging and out-swinging corners with attacking runs.', 'Set Pieces', 'First Team', 15, 'Corner flags, balls', 'Corner taker alternates in-swing and out-swing. Attackers make timed runs: near post flick, far post header, edge of box volley. Rotate takers.', 'Main Activity'),
      ('Counter-Attack Transition', 'Win the ball and break fast from defence to attack.', 'Transition', 'First Team', 20, 'Bibs, 2 goals, balls', '5v5 in a half-pitch. When a team wins the ball, they have 5 seconds to get a shot on goal. Defenders must recover quickly.', 'Main Activity'),
      ('Possession Under Pressure', 'Maintain possession in a congested area with limited touches.', 'Possession', 'First Team', 20, 'Bibs, cones, balls', '6v3 in a 20x20 grid. Possession team has 2-touch limit. Defenders try to win it back. 3 consecutive possessions = 1 point.', 'Main Activity'),
      ('1v1 Defending', 'Individual defending: jockey, delay, and win the ball cleanly.', 'Defending', 'U15', 15, 'Cones, balls', 'Attacker starts with the ball at the edge of the box. Defender jockeys and tries to win possession. 1v1 to goal. Rotate every rep.', 'Main Activity'),
      ('Quick Transition Rondo', 'Lose the ball, react instantly to press or recover.', 'Transition', 'U17', 15, 'Bibs, cones, balls', '5v2 rondo. When defenders win it, they immediately become attackers and the losers become defenders. Fast transitions.', 'Main Activity'),
      ('First Touch & Turn', 'Receive the ball under pressure and turn to face goal.', 'Ball Mastery', 'U15', 15, 'Cones, balls', 'Player receives a pass with a defender on their back. First touch to turn away from pressure, then drive forward. Progress to 1v1.', 'Main Activity'),
      ('Light Possession Cool-down', 'Low-intensity rondo to bring the heart rate down.', 'Possession', 'First Team', 8, '1 ball', '6v2 rondo in a large grid. No pressure, focus on clean passing. Keep it relaxed.', 'Cool-down'),
      ('Stretching & Reflection', 'Static stretching with team discussion on the session.', 'Ball Mastery', 'First Team', 7, 'None', 'Team sits in a circle. Lead stretches for each major muscle group. Discuss what went well and what to improve.', 'Cool-down'),
      ('Walking Pass & Move', 'Very light passing while walking to cool down.', 'Possession', 'U15', 5, '1 ball', 'Players walk around the pitch passing the ball. No pressure, focus on technique and breathing.', 'Cool-down')
    ) AS v(name, description, tactical_goal, age_group, duration_minutes, equipment, instructions, phase)
    WHERE NOT EXISTS (
      SELECT 1 FROM drills d
      WHERE d.squad_id = s.id AND d.name = v.name
    );
  `)
}

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM drills d
    USING squads s
    WHERE d.squad_id = s.id
      AND d.name IN (
        'Rondo 4v2', 'Dynamic Stretching Circuit', 'Passing Pairs',
        'Through Ball & Finish', 'Zonal Defending Shape', 'Corner Delivery & Finishing',
        'Counter-Attack Transition', 'Possession Under Pressure', '1v1 Defending',
        'Quick Transition Rondo', 'First Touch & Turn',
        'Light Possession Cool-down', 'Stretching & Reflection', 'Walking Pass & Move'
      )
  `)
}
