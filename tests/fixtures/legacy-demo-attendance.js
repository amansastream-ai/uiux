'use strict';

/**
 * Frozen v1 attendance generator used only to exercise the safe demo migration.
 * It intentionally mirrors the pre-v2 seed so its fingerprint matches exactly.
 */
function seedLegacyDemoAttendance(db) {
  const att = db.prepare('INSERT INTO attendance(employee_id, type, ts, method, device, note) VALUES (?, ?, ?, ?, ?, ?)');
  const emps = db.prepare('SELECT * FROM employees ORDER BY id').all();

  let seedn = 42;
  const rnd = () => (seedn = (seedn * 1103515245 + 12345) % 2147483648) / 2147483648;
  const push = (employeeId, type, date, time, method) =>
    att.run(employeeId, type, `${date}T${time}:00`, method || (rnd() > 0.4 ? 'qr' : 'fingerprint'), 'Tablette-Pointage-01', null);
  const eachDate = (from, to, callback) => {
    const date = new Date(`${from}T12:00:00`);
    const end = new Date(`${to}T12:00:00`);
    while (date <= end) {
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      callback(iso, date.getDay());
      date.setDate(date.getDate() + 1);
    }
  };

  eachDate('2026-09-01', '2026-10-17', (iso, dayOfWeek) => {
    for (const employee of emps) {
      const id = Number(employee.id);
      const departmentId = Number(employee.department_id);
      if (rnd() < 0.04) continue;

      if (employee.schedule_name === 'Nuit') {
        push(id, 'in', iso, '21:58');
        push(id, 'out', iso, '06:02');
      } else if (employee.schedule_name === 'Rotation 7j/7') {
        if (departmentId === 5 && id === 11) {
          push(id, 'in', iso, '05:57');
          push(id, 'out', iso, '14:05');
        } else {
          push(id, 'in', iso, '13:58');
          push(id, 'out', iso, '22:04');
        }
      } else {
        const worksSaturday = departmentId === 2 && id !== 4 && rnd() > 0.55;
        if (dayOfWeek === 0 || (dayOfWeek === 6 && !worksSaturday)) continue;
        const late = rnd() < 0.08;
        push(id, 'in', iso, late
          ? (employee.schedule_start === '07:00' ? '07:22' : '08:19')
          : (employee.schedule_start === '07:00' ? '06:58' : '07:58'));
        const heavy = rnd() < 0.18;
        let outTime = '17:05';
        if (dayOfWeek === 5) outTime = '16:07';
        if (worksSaturday && dayOfWeek === 6) outTime = '13:10';
        if (heavy) outTime = rnd() > 0.5 ? '20:12' : '19:35';
        if (employee.schedule_start === '07:00') outTime = heavy ? '18:40' : '16:08';
        push(id, 'out', iso, outTime);
      }
    }
  });

  const fix = db.prepare('UPDATE attendance SET ts = ? WHERE id = ?');
  const nights = db.prepare("SELECT id, ts FROM attendance WHERE employee_id IN (9,10) AND type = 'out' AND ts LIKE '%T06:02:00'").all();
  for (const night of nights) {
    const date = new Date(night.ts);
    date.setDate(date.getDate() + 1);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    fix.run(`${iso}T06:02:00`, night.id);
  }

  att.run(4, 'out', '2026-10-14T18:10:00', 'manual', 'Bureau', 'Correction : oubli de pointage de sortie');
  att.run(7, 'in', '2026-09-23T07:15:00', 'manual', 'Bureau', 'Badge QR non reconnu, saisie manuelle');
}

module.exports = { seedLegacyDemoAttendance };
