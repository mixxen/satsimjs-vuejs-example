<template>
  <aside v-if="selection" class="object-sidebar" aria-label="Selected object details">
    <header class="object-sidebar-header">
      <div>
        <span class="object-type">{{ selection.type }}</span>
        <h2>{{ selection.name }}</h2>
      </div>
      <button class="icon-button" type="button" aria-label="Close object details" title="Close" @click="$emit('close')">
        <X :size="18" />
      </button>
    </header>

    <div class="object-actions">
      <button
        class="sidebar-action"
        type="button"
        :disabled="!selection.canFocus"
        @click="$emit('focus-track')"
      >
        Focus Track
      </button>
      <label class="sidebar-toggle" :class="{ disabled: !selection.canTrace }">
        <input
          type="checkbox"
          :checked="selection.traceEnabled"
          :disabled="!selection.canTrace"
          @change="$emit('toggle-trace', $event.target.checked)"
        />
        <span>Trace</span>
      </label>
      <label class="sidebar-toggle" :class="{ disabled: !selection.canLabel }">
        <input
          type="checkbox"
          :checked="selection.labelEnabled"
          :disabled="!selection.canLabel"
          @change="$emit('toggle-label', $event.target.checked)"
        />
        <span>Label</span>
      </label>
    </div>

    <div class="object-content">
      <section v-for="section in selection.sections" :key="section.title" class="object-section">
        <h3>{{ section.title }}</h3>

        <dl v-if="section.rows?.length" class="object-facts">
          <template v-for="row in section.rows" :key="`${section.title}-${row.label}`">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </template>
        </dl>

        <pre v-if="section.lines?.length" class="object-code"><code>{{ section.lines.join("\n") }}</code></pre>
      </section>

      <section v-if="selection.visibility" class="object-section object-visibility">
        <div class="object-section-heading">
          <h3>Visibility</h3>
          <span>{{ selection.visibility.summary }}</span>
        </div>

        <div class="object-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sensor</th>
                <th>Visible</th>
                <th>Az</th>
                <th>El</th>
                <th>Range</th>
                <th>Phase</th>
                <th>VMag</th>
                <th>Rate</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIndex) in selection.visibility.rows" :key="`${row.sensor}-${rowIndex}`">
                <td>{{ row.sensor }}</td>
                <td>
                  <span class="visibility-pill" :class="{ visible: row.visible }">{{ row.visibleText }}</span>
                </td>
                <td>{{ row.azimuth }}</td>
                <td>{{ row.elevation }}</td>
                <td>{{ row.range }}</td>
                <td>{{ row.phase }}</td>
                <td>{{ row.magnitude }}</td>
                <td>{{ row.rate }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </aside>
</template>

<script setup>
import { X } from "lucide-vue-next";

defineProps({
  selection: {
    type: Object,
    default: undefined
  }
});

defineEmits(["close", "focus-track", "toggle-label", "toggle-trace"]);
</script>
